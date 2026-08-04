import { useCallback, useEffect, useRef, useState } from 'react'

// Mantém loading/erro sincronizados e ignora respostas de uma tela que já foi desmontada.
export function useApiResource(loader, initialValue) {
  const [value, setValue] = useState(initialValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const nextValue = await loader()
      if (!mounted.current) return nextValue
      setValue(nextValue)
      return nextValue
    } catch (caught) {
      if (!mounted.current) throw caught
      setError(caught.message)
      throw caught
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    let active = true
    setLoading(true)
    loader()
      .then(nextValue => { if (active) setValue(nextValue) })
      .catch(caught => { if (active) setError(caught.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loader])

  return { value, setValue, loading, error, setError, reload }
}
