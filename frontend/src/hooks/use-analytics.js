import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { detectNetworks } from '../lib/analytics-format.js'

const AUTO_REFRESH_MS = 30000
const EMPTY_DATA = {
  series: {}, metrics: [], instagramFollowers: {}, tiktokStats: {},
  youtubeSubscribers: {}, instagramDemographics: null, youtubeDemographics: null,
  accountAnalytics: { platforms: {}, capabilities: {}, dailyMetrics: [], contentDecay: [], errors: [] },
}

// Espelha o padrão do Analytics legado (public/app.html): dois fetches
// independentes (analytics + tiktok-videos, o 2º sempre roda mesmo se o 1º
// falhar), auto-refresh a cada 30s enquanto a aba está visível, e troca
// automática para a primeira rede com dados se a rede ativa ficar sem dados
// depois de um refresh.
export function useAnalytics() {
  const [data, setData] = useState(EMPTY_DATA)
  const [tiktokVideos, setTiktokVideos] = useState([])
  const [activeNet, setActiveNet] = useState('instagram')
  const [activeTab, setActiveTab] = useState('community')
  const [periodDays, setPeriodDays] = useState(7)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const activeNetRef = useRef(activeNet)
  const tiktokVideosRef = useRef(tiktokVideos)
  activeNetRef.current = activeNet
  tiktokVideosRef.current = tiktokVideos

  const loadTiktokVideos = useCallback(async () => {
    try {
      const { videos } = await apiFetch('/api/posts/tiktok-videos')
      setTiktokVideos(videos || [])
    } catch {
      setTiktokVideos([])
    }
  }, [])

  const loadAnalytics = useCallback(async () => {
    try {
      const result = await apiFetch(`/api/posts/analytics?days=${periodDays}`)
      const next = {
        series: result.series || {},
        metrics: result.metrics || [],
        instagramFollowers: result.instagramFollowers || {},
        tiktokStats: result.tiktokStats || {},
        youtubeSubscribers: result.youtubeSubscribers || {},
        instagramDemographics: result.instagramDemographics || null,
        youtubeDemographics: result.youtubeDemographics || null,
        accountAnalytics: result.accountAnalytics || EMPTY_DATA.accountAnalytics,
      }
      setData(next)
      setError('')

      const nets = detectNetworks({ ...next, tiktokVideos: tiktokVideosRef.current })
      if (nets.length && !nets.includes(activeNetRef.current)) setActiveNet(nets[0])

      setLastUpdated(new Date())
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
    loadTiktokVideos()
  }, [loadTiktokVideos, periodDays])

  useEffect(() => {
    loadAnalytics()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') loadAnalytics()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays])

  const networks = detectNetworks({ ...data, tiktokVideos })

  function selectNetwork(net) {
    setActiveNet(net)
    setActiveTab('community')
  }

  return {
    data, tiktokVideos, networks, activeNet, activeTab, periodDays,
    loading, error, lastUpdated,
    setActiveTab, setPeriodDays, selectNetwork, reload: loadAnalytics,
  }
}
