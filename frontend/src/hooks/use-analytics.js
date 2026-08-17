import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api.js'
import { detectNetworks, DEFAULT_ANALYTICS_PERIOD, ANALYTICS_PERIODS } from '../lib/analytics-format.js'

const AUTO_REFRESH_MS = 30000
const ANALYTICS_FILTERS_KEY = 'meu-ecoo:analytics-filters'

function readAnalyticsFilters() {
  try { return JSON.parse(localStorage.getItem(ANALYTICS_FILTERS_KEY) || '{}') } catch { return {} }
}
const EMPTY_DATA = {
  series: {}, metrics: [], instagramFollowers: {}, tiktokStats: {},
  youtubeSubscribers: {}, instagramDemographics: null, youtubeDemographics: null,
  accountAnalytics: { platforms: {}, capabilities: {}, dailyMetrics: [], contentDecay: [], bestTimeToPost: [], errors: [] },
}

// Mantém o carregamento de analytics em duas fontes independentes
// independentes (analytics + tiktok-videos, o 2º sempre roda mesmo se o 1º
// falhar), auto-refresh a cada 30s enquanto a aba está visível, e troca
// automática para a primeira rede com dados se a rede ativa ficar sem dados
// depois de um refresh.
export function useAnalytics({ comparePeriod = false } = {}) {
  const savedFilters = readAnalyticsFilters()
  const [data, setData] = useState(EMPTY_DATA)
  const [accounts, setAccounts] = useState([])
  const [tiktokVideos, setTiktokVideos] = useState([])
  const [activeNet, setActiveNet] = useState(savedFilters.activeNet || 'instagram')
  const [activeTab, setActiveTab] = useState(savedFilters.activeTab || 'community')
  const savedPeriod = Number(savedFilters.periodDays)
  const [periodDays, setPeriodDays] = useState(ANALYTICS_PERIODS.includes(savedPeriod) ? savedPeriod : DEFAULT_ANALYTICS_PERIOD)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const activeNetRef = useRef(activeNet)
  const tiktokVideosRef = useRef(tiktokVideos)
  activeNetRef.current = activeNet
  tiktokVideosRef.current = tiktokVideos

  useEffect(() => {
    localStorage.setItem(ANALYTICS_FILTERS_KEY, JSON.stringify({ activeNet, activeTab, periodDays }))
  }, [activeNet, activeTab, periodDays])

  const loadTiktokVideos = useCallback(async () => {
    try {
      const { videos } = await apiFetch('/api/posts/tiktok-videos')
      setTiktokVideos(videos || [])
    } catch {
      setTiktokVideos([])
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    try {
      const result = await apiFetch('/api/accounts')
      setAccounts(result.data || [])
    } catch {
      setAccounts([])
    }
  }, [])

  const loadAnalytics = useCallback(async () => {
    try {
      const queryDays = Math.min(90, periodDays * (comparePeriod ? 2 : 1))
      // Agrega métricas ao vivo de várias contas/plataformas — pode passar
      // do timeout padrão de 15s da apiFetch em contas com muitas publicações.
      const result = await apiFetch(`/api/posts/analytics?days=${queryDays}`, { timeoutMs: 45_000 })
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
  }, [loadTiktokVideos, periodDays, comparePeriod])

  useEffect(() => {
    loadAnalytics()
    loadAccounts()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') loadAnalytics()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays, comparePeriod, loadAccounts])

  const networks = detectNetworks({ ...data, tiktokVideos })

  function selectNetwork(net) {
    setActiveNet(net)
    setActiveTab('community')
  }

  return {
    data, accounts, tiktokVideos, networks, activeNet, activeTab, periodDays,
    loading, error, lastUpdated,
    setActiveTab, setPeriodDays, selectNetwork, reload: loadAnalytics,
  }
}
