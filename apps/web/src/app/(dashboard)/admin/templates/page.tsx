'use client'
import { PageHeader } from '@/components/ui'
import { TemplatesPanel } from './TemplatesPanel'

// Standalone route — wraps the same panel that's embedded as a tab inside
// the main Admin page.
export default function TemplatesPage() {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <PageHeader
        title="Project Templates"
        subtitle="Tasks are copied once when applied — edits don't propagate back."
      />
      <TemplatesPanel />
    </div>
  )
}
