/**
 * Upload a file to Supabase Storage (public "assets" bucket).
 *
 * Uses the anon key directly — the bucket has a public read policy and an
 * authenticated upload policy. Returns the permanent public URL.
 *
 * Usage:
 *   const url = await uploadFile(file, 'clients')
 *   // → https://rqlt...supabase.co/storage/v1/object/public/assets/clients/abc123.png
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function uploadFile(
  file: File,
  folder: string = 'misc',
): Promise<string> {
  // Generate a unique filename: folder/timestamp-random.ext
  const ext  = file.name.split('.').pop()?.toLowerCase() || 'png'
  const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/assets/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': file.type,
      'x-upsert': 'true',
    },
    body: file,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Upload failed (${res.status})`)
  }

  // Return the public URL
  return `${SUPABASE_URL}/storage/v1/object/public/assets/${name}`
}
