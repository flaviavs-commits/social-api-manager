export function createPostValidationWorker(onResult) {
  if (typeof Worker === 'undefined') return null
  const worker = new Worker(new URL('../workers/post-validation.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = event => onResult(event.data)
  return worker
}
