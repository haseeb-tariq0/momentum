// ── Export utilities ──────────────────────────────────────────────────────────
// Supports CSV, Excel (.xlsx via SheetJS), and PDF (.pdf via jsPDF + autoTable)

// ── CSV helpers ───────────────────────────────────────────────────────────────
// CSV formula injection guard: cells beginning with =, +, -, @, \t, \r are
// interpreted as formulas by Excel and LibreOffice. A task named `=1+1` or
// `=cmd|'/c calc'!A1` would execute on open. Prefix any such cell with `'`
// (which Excel hides) to neutralise it.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/
function escapeCell(val: any): string {
  if (val === null || val === undefined) return ''
  let str = String(val)
  if (FORMULA_TRIGGERS.test(str)) str = "'" + str
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

function buildCSV(headers: string[], rows: any[][]): string {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(row => row.map(escapeCell).join(',')),
  ]
  return '\uFEFF' + lines.join('\n') // UTF-8 BOM for Google Sheets
}

export function downloadCSV(filename: string, headers: string[], rows: any[][]) {
  const csv  = buildCSV(headers, rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// ── Excel (.xlsx) via SheetJS — loaded dynamically ────────────────────────────
async function loadXLSX(): Promise<any> {
  // Use globally cached copy if available
  if ((window as any).__XLSX__) return (window as any).__XLSX__
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
    script.onload  = () => { (window as any).__XLSX__ = (window as any).XLSX; resolve((window as any).XLSX) }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

export async function downloadXLSX(
  filename: string,
  headers: string[],
  rows: any[][],
  sheetName = 'Report',
  /** optional extra sheets: [{name, headers, rows}] */
  extraSheets?: { name: string; headers: string[]; rows: any[][] }[]
) {
  const XLSX = await loadXLSX()
  const wb   = XLSX.utils.book_new()

  function neutralize(cell: any): any {
    if (cell === null || cell === undefined) return ''
    if (typeof cell === 'number' || typeof cell === 'boolean') return cell
    const str = String(cell)
    return FORMULA_TRIGGERS.test(str) ? "'" + str : str
  }

  function makeSheet(hdrs: string[], data: any[][]) {
    // Sanitize each cell against formula injection before handing to SheetJS
    const safeRows = data.map(row => row.map(neutralize))
    const ws = XLSX.utils.aoa_to_sheet([hdrs, ...safeRows])
    // Auto column width
    const maxLen = (hdrs.map((h: string) => h.length) as number[])
    safeRows.forEach(row => row.forEach((cell: any, ci: number) => {
      const l = String(cell ?? '').length
      if (l > (maxLen[ci] ?? 0)) maxLen[ci] = l
    }))
    ws['!cols'] = maxLen.map((w: number) => ({ wch: Math.min(w + 2, 50) }))
    return ws
  }

  XLSX.utils.book_append_sheet(wb, makeSheet(headers, rows), sheetName)
  if (extraSheets) {
    for (const s of extraSheets) {
      XLSX.utils.book_append_sheet(wb, makeSheet(s.headers, s.rows), s.name)
    }
  }

  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx')
}

// ── PDF via jsPDF + AutoTable — loaded dynamically ────────────────────────────
// IMPORTANT: load jsPDF FIRST, then autoTable. Loading them in parallel causes
// a race: if the autoTable UMD script parses before jsPDF, it can't find
// `window.jspdf` to attach to, silently no-ops, and `doc.autoTable()` ends up
// undefined at call time — PDF exports then fail with a runtime error that
// only surfaces when the user clicks Export.
function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => res()
    s.onerror = () => rej(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

async function loadJsPDF(): Promise<{ jsPDF: any; autoTable: any }> {
  if ((window as any).__jsPDF__) return (window as any).__jsPDF__
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const jsPDF = (window as any).jspdf?.jsPDF || (window as any).jsPDF
  if (!jsPDF) throw new Error('jsPDF loaded but global not found')
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
  // Verify the plugin actually registered on the prototype. If it didn't,
  // fail loudly instead of generating broken PDFs.
  if (typeof jsPDF.API?.autoTable !== 'function') {
    throw new Error('jsPDF-autotable plugin failed to register')
  }
  const result = { jsPDF, autoTable: null }
  ;(window as any).__jsPDF__ = result
  return result
}

export async function downloadPDF(
  filename: string,
  title: string,
  subtitle: string,
  headers: string[],
  rows: any[][],
  /** optional summary stats shown above the table */
  stats?: { label: string; value: string }[]
) {
  const { jsPDF } = await loadJsPDF()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // ── Header band ──────────────────────────────────────────────────────────────
  doc.setFillColor(17, 19, 24) // --bg-raised dark
  doc.rect(0, 0, pageW, 22, 'F')

  doc.setTextColor(59, 130, 246) // --accent blue
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Digital Nexa', 14, 10)

  doc.setTextColor(232, 234, 240) // --text-primary
  doc.setFontSize(11)
  doc.text(title, 14, 17)

  doc.setTextColor(136, 146, 164) // --text-secondary
  doc.setFontSize(8)
  doc.text(subtitle, 14, 22.5)
  doc.text(`Generated ${today}`, pageW - 14, 22.5, { align: 'right' })

  // ── Stats row ────────────────────────────────────────────────────────────────
  let tableStartY = 30
  if (stats && stats.length > 0) {
    const boxW   = Math.min((pageW - 28) / stats.length, 50)
    const startX = 14
    stats.forEach((s, i) => {
      const x = startX + i * (boxW + 3)
      doc.setFillColor(22, 24, 32)
      doc.roundedRect(x, 26, boxW, 14, 2, 2, 'F')
      doc.setTextColor(136, 146, 164)
      doc.setFontSize(6)
      doc.setFont('helvetica', 'bold')
      doc.text(s.label.toUpperCase(), x + 3, 30.5)
      doc.setTextColor(232, 234, 240)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(String(s.value), x + 3, 36.5)
    })
    tableStartY = 44
  }

  // ── Table ────────────────────────────────────────────────────────────────────
  ;(doc as any).autoTable({
    head: [headers],
    body: rows.map(row => row.map(cell => (cell === null || cell === undefined) ? '' : String(cell))),
    startY: tableStartY,
    margin: { left: 14, right: 14 },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: [200, 204, 212],
      fillColor: [17, 19, 24],
      lineColor: [40, 44, 56],
      lineWidth: 0.2,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: [22, 24, 32],
      textColor: [136, 146, 164],
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [20, 22, 30] },
    columnStyles: {},
    didDrawPage: (data: any) => {
      // Footer on each page
      const pg = doc.internal.getCurrentPageInfo().pageNumber
      const total = (doc as any).internal.getNumberOfPages()
      doc.setTextColor(74, 85, 104)
      doc.setFontSize(7)
      doc.text(
        `Digital Nexa — ${title} — Page ${pg} of ${total}`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 6,
        { align: 'center' }
      )
    },
  })

  doc.save(filename.endsWith('.pdf') ? filename : filename + '.pdf')
}

// ── Partner Report PDF — matches Murtaza's monthly report template ────────────
// Layout: header + two side-by-side summary tables ("Breakdown by Team" and
// "Breakdown by Project"), then "Billable time" detail table below.
export async function downloadPartnerReportPDF(opts: {
  filename: string
  clientName: string
  monthLabel: string       // e.g. "March 2026"
  currency: string         // AED / USD / SAR
  summary: {
    byProject: { name: string; hours: number; cost: number }[]
    byDepartment: { name: string; hours: number; cost: number; rate?: number }[]
    totalHrs: number
    totalCost: number
  }
  detailHeaders: string[]
  detailRows: any[][]
}) {
  const { jsPDF } = await loadJsPDF()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const pageW = doc.internal.pageSize.getWidth()
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  // ── Header band ──
  doc.setFillColor(17, 19, 24)
  doc.rect(0, 0, pageW, 22, 'F')

  doc.setTextColor(59, 130, 246)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Digital Nexa', 14, 10)

  doc.setTextColor(232, 234, 240)
  doc.setFontSize(12)
  doc.text(`${opts.clientName} — Monthly Report`, 14, 17)

  doc.setTextColor(136, 146, 164)
  doc.setFontSize(8)
  doc.text(opts.monthLabel, 14, 22.5)
  doc.text(`Generated ${today}`, pageW - 14, 22.5, { align: 'right' })

  // ── Two side-by-side summary tables ──
  const summaryY = 28
  const half = (pageW - 28 - 4) / 2
  const leftX = 14
  const rightX = 14 + half + 4

  // Section labels
  doc.setTextColor(59, 130, 246)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Breakdown by Team', leftX, summaryY)
  doc.text('Breakdown by Project', rightX, summaryY)

  doc.setTextColor(136, 146, 164)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  doc.text(`Client summary for ${opts.monthLabel}`, leftX, summaryY + 3.5)
  doc.text(`Client summary for ${opts.monthLabel}`, rightX, summaryY + 3.5)

  const teamRows = opts.summary.byDepartment.map(d => [
    d.name,
    d.hours.toFixed(2),
    `${opts.currency} ${Math.round(d.cost).toLocaleString()}`,
  ])
  teamRows.push([
    'Total billable',
    opts.summary.totalHrs.toFixed(2),
    `${opts.currency} ${Math.round(opts.summary.totalCost).toLocaleString()}`,
  ])

  const projectRows = opts.summary.byProject.map(p => [
    p.name,
    p.hours.toFixed(2),
    `${opts.currency} ${Math.round(p.cost).toLocaleString()}`,
  ])
  projectRows.push([
    'Total billable',
    opts.summary.totalHrs.toFixed(2),
    `${opts.currency} ${Math.round(opts.summary.totalCost).toLocaleString()}`,
  ])

  const summaryStyles = {
    fontSize: 8, cellPadding: 2,
    textColor: [200, 204, 212] as [number, number, number],
    fillColor: [17, 19, 24] as [number, number, number],
    lineColor: [40, 44, 56] as [number, number, number],
    lineWidth: 0.1, font: 'helvetica',
  }
  const summaryHeadStyles = {
    fillColor: [22, 24, 32] as [number, number, number],
    textColor: [136, 146, 164] as [number, number, number],
    fontStyle: 'bold', fontSize: 7,
  }

  ;(doc as any).autoTable({
    head: [['Team', 'Hours', 'Total Cost']],
    body: teamRows,
    startY: summaryY + 6,
    margin: { left: leftX },
    tableWidth: half,
    styles: summaryStyles,
    headStyles: summaryHeadStyles,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })
  const teamEndY = (doc as any).lastAutoTable.finalY

  ;(doc as any).autoTable({
    head: [['Project', 'Hours', 'Total Cost']],
    body: projectRows,
    startY: summaryY + 6,
    margin: { left: rightX },
    tableWidth: half,
    styles: summaryStyles,
    headStyles: summaryHeadStyles,
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })
  const projectEndY = (doc as any).lastAutoTable.finalY

  // ── Billable time detail table ──
  const detailStartY = Math.max(teamEndY, projectEndY) + 8
  doc.setTextColor(59, 130, 246)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('Billable time', 14, detailStartY)

  ;(doc as any).autoTable({
    head: [opts.detailHeaders],
    body: opts.detailRows.map(row => row.map(cell => (cell === null || cell === undefined) ? '' : String(cell))),
    startY: detailStartY + 3,
    margin: { left: 14, right: 14 },
    styles: {
      fontSize: 7, cellPadding: 1.5,
      textColor: [200, 204, 212], fillColor: [17, 19, 24],
      lineColor: [40, 44, 56], lineWidth: 0.1, font: 'helvetica',
    },
    headStyles: {
      fillColor: [22, 24, 32], textColor: [136, 146, 164],
      fontStyle: 'bold', fontSize: 6.5,
    },
    alternateRowStyles: { fillColor: [20, 22, 30] },
    didDrawPage: () => {
      const pg = doc.internal.getCurrentPageInfo().pageNumber
      const total = (doc as any).internal.getNumberOfPages()
      doc.setTextColor(74, 85, 104)
      doc.setFontSize(7)
      doc.text(
        `${opts.clientName} — ${opts.monthLabel} — Page ${pg} of ${total}`,
        pageW / 2,
        doc.internal.pageSize.getHeight() - 6,
        { align: 'center' }
      )
    },
  })

  doc.save(opts.filename.endsWith('.pdf') ? opts.filename : opts.filename + '.pdf')
}

// ── P&L Export ────────────────────────────────────────────────────────────────
export function exportPnL(projects: any[], rateCards: any[], currency = 'AED') {
  const headers = [
    'Project ID', 'Project Name', 'Client', 'Status', 'Budget Type',
    `Budget (${currency})`, 'Rate Card',
    'Estimated Hours', 'Actual Hours', 'Billable Hours', 'Non-Billable Hours',
    `Cost (${currency})`, `Profit (${currency})`, 'Margin %',
    'Hours Used %', 'Tasks Total', 'Tasks Done',
    'Start Date', 'End Date',
  ]

  const rows = projects.map((p: any) => {
    const est      = p.stats?.estimatedHrs || 0
    const logged   = p.stats?.loggedHrs    || 0
    const billable = p.stats?.billableHrs  || 0
    const budget   = Number(p.budget_amount) || 0
    
    let cost = 0
    const rc = rateCards.find((r: any) => r.id === p.rate_card_id)
    if (rc && billable > 0) {
      const entries = rc.rate_card_entries || []
      if (entries.length > 0) {
        const avgRate = entries.reduce((s: number, e: any) => s + Number(e.hourly_rate), 0) / entries.length
        cost = billable * avgRate
      }
    }

    const profit = budget > 0 ? budget - cost : 0
    const margin = budget > 0 && cost > 0 ? Math.round((profit / budget) * 100) : ''
    const hrsPct = est > 0 ? Math.round((logged / est) * 100) : ''

    return [
      p.id?.slice(-6)?.toUpperCase() || '',
      p.name,
      p.clients?.name || '',
      p.status,
      (p.budget_type || '').replace(/_/g, ' '),
      budget || '',
      rc?.name || '',
      est,
      logged,
      billable,
      logged - billable,
      cost > 0 ? Math.round(cost) : '',
      profit > 0 ? Math.round(profit) : '',
      margin !== '' ? margin + '%' : '',
      hrsPct !== '' ? hrsPct + '%' : '',
      0, 0,
      p.start_date ? p.start_date.slice(0, 10) : '',
      p.end_date   ? p.end_date.slice(0, 10)   : '',
    ]
  })

  const date = new Date().toISOString().slice(0, 10)
  downloadCSV(`PnL-Report-${date}.csv`, headers, rows)
}

// ── Timesheet Export ──────────────────────────────────────────────────────────
export function exportTimesheetWeek(weekData: any, weekLabel: string) {
  const headers = [
    'Task / Category', 'Type', 'Project', 'Client',
    'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    'Week Total', 'Billable',
  ]

  const rows = (weekData.rows || []).map((row: any) => {
    const days = weekData.days || []
    const dayHrs = days.map((d: any) => {
      const cell = row.days?.[d.date]
      return cell?.hours || ''
    })
    const rowTotal    = Object.values(row.days || {}).reduce((s: number, d: any) => s + (d?.hours || 0), 0)
    const rowBillable = Object.values(row.days || {}).filter((d: any) => d?.billable).reduce((s: number, d: any) => s + (d?.hours || 0), 0)
    return [
      row.taskTitle || row.categoryName || '',
      row.type || 'project',
      row.projectName || '',
      row.clientName || '',
      ...dayHrs,
      rowTotal || '',
      rowBillable || '',
    ]
  })

  if (weekData.dayTotals) {
    const days = weekData.days || []
    rows.push([
      'TOTAL', '', '', '',
      ...days.map((d: any) => weekData.dayTotals[d.date] || 0),
      weekData.totalHrs || 0,
      weekData.billableHrs || 0,
    ])
  }

  downloadCSV(`Timesheet-${weekLabel}.csv`, headers, rows)
}

// ── Team Timesheet Compliance Export ─────────────────────────────────────────
export function exportCompliance(complianceData: any[], weekLabel: string) {
  const headers = [
    'Name', 'Department', 'Job Title', 'Capacity (hrs)',
    'Logged (hrs)', 'Billable (hrs)', 'Non-Billable (hrs)',
    'Days Logged', 'Utilization %', 'Status',
  ]

  const rows = complianceData.map((u: any) => {
    const nonBill = (u.loggedHrs || 0) - (u.billableHrs || 0)
    const util    = u.capacityHrs > 0 ? Math.round(((u.loggedHrs || 0) / u.capacityHrs) * 100) : 0
    return [
      u.name,
      u.department,
      u.jobTitle,
      u.capacityHrs,
      u.loggedHrs || 0,
      u.billableHrs || 0,
      nonBill,
      u.daysLogged || 0,
      util + '%',
      u.submitted ? 'Submitted' : 'Missing',
    ]
  })

  downloadCSV(`Compliance-${weekLabel}.csv`, headers, rows)
}

// ── Project Tasks Export ──────────────────────────────────────────────────────
export function exportProjectTasks(project: any) {
  const headers = [
    'Phase', 'Task', 'Status', 'Billable',
    'Estimated (hrs)', 'Logged (hrs)', 'Billable (hrs)',
    'Assignees', 'Progress %',
  ]

  const rows: any[][] = []
  for (const phase of project.phases || []) {
    for (const task of phase.tasks || []) {
      const logged   = (task.time_entries || []).reduce((s: number, e: any) => s + Number(e.hours), 0)
      const billable = (task.time_entries || []).filter((e: any) => e.billable).reduce((s: number, e: any) => s + Number(e.hours), 0)
      const est      = Number(task.estimated_hrs) || 0
      const pct      = est > 0 ? Math.round((logged / est) * 100) : ''
      const assignees = (task.task_assignees || []).map((a: any) => a.users?.name).filter(Boolean).join('; ')
      rows.push([
        phase.name,
        task.title,
        task.status,
        task.billable ? 'Yes' : 'No',
        est || '',
        logged || '',
        billable || '',
        assignees,
        pct !== '' ? pct + '%' : '',
      ])
    }
  }

  downloadCSV(`${project.name.replace(/[^a-z0-9]/gi, '-')}-Tasks.csv`, headers, rows)
}
