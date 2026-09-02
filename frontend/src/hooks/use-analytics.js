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
  verification: null,
  accountAnalytics: { platforms: {}, capabilities: {}, dailyMetrics: [], contentDecay: [], bestTimeToPost: [], errors: [] },
}

// Mantém o carregamento de analytics em duas fontes independentes
// (analytics + tiktok-videos), mas aguarda as duas antes de liberar a tela.
// Assim o resumo do TikTok não aparece temporariamente com "—" enquanto a
// fonte real de vídeos ainda está sendo consultada. Também faz auto-refresh a
// cada 30s enquanto a aba está visível e troca automaticamente para a primeira
// rede com dados se a rede ativa ficar sem dados depois de um refresh.
export function useAnalytics({ comparePeriod = false } = {}) {
  const savedFilters = readAnalyticsFilters()
  const [data, setData] = useState(EMPTY_DATA)
  const [accounts, setAccounts] = useState([])
  const [tiktokVideos, setTiktokVideos] = useState([])
  const initialNetwork = savedFilters.activeNet === 'all' || savedFilters.activeNet ? savedFilters.activeNet : 'all'
  const [activeNet, setActiveNet] = useState(initialNetwork)
  const [activeTab, setActiveTab] = useState(savedFilters.activeTab || 'community')
  const savedPeriod = Number(savedFilters.periodDays)
  const [periodDays, setPeriodDays] = useState(ANALYTICS_PERIODS.includes(savedPeriod) ? savedPeriod : DEFAULT_ANALYTICS_PERIOD)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sourceErrors, setSourceErrors] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)
  const activeNetRef = useRef(activeNet)
  activeNetRef.current = activeNet

  useEffect(() => {
    localStorage.setItem(ANALYTICS_FILTERS_KEY, JSON.stringify({ activeNet, activeTab, periodDays }))
  }, [activeNet, activeTab, periodDays])

  const loadAccounts = useCallback(async () => {
    try {
      const result = await apiFetch('/api/accounts')
      setAccounts(result.data || [])
      setSourceErrors(current => current.filter(issue => issue.source !== 'Contas conectadas'))
    } catch (caught) {
      setAccounts([])
      setSourceErrors(current => current.some(issue => issue.source === 'Contas conectadas')
        ? current
        : [...current, { source: 'Contas conectadas', message: caught.message || 'Não foi possível verificar as contas.' }])
    }
  }, [])

  const loadAnalytics = useCallback(async () => {
    setLoading(true)
    const queryDays = Math.min(90, periodDays * (comparePeriod ? 2 : 1))
    // As duas fontes são consultadas em paralelo. O endpoint de vídeos do
    // TikTok é a fonte dos valores por vídeo; iniciar essa chamada somente
    // depois do relatório principal fazia a tela exibir placeholders por
    // vários segundos, mesmo quando a API tinha os números reais.
    const [analyticsResult, tiktokResult] = await Promise.allSettled([
      // Agrega métricas ao vivo de várias contas/plataformas — pode passar
      // do timeout padrão de 15s da apiFetch em contas com muitas publicações.
      apiFetch(`/api/posts/analytics?days=${queryDays}`, { timeoutMs: 45_000 }),
      apiFetch('/api/posts/tiktok-videos', { timeoutMs: 45_000 }),
    ])

    if (analyticsResult.status === 'fulfilled') {
      const result = analyticsResult.value
      const next = {
        series: result.series || {},
        metrics: result.metrics || [],
        instagramFollowers: result.instagramFollowers || {},
        tiktokStats: result.tiktokStats || {},
        youtubeSubscribers: result.youtubeSubscribers || {},
        instagramDemographics: result.instagramDemographics || null,
        youtubeDemographics: result.youtubeDemographics || null,
        verification: result.verification || null,
        accountAnalytics: result.accountAnalytics || EMPTY_DATA.accountAnalytics,
      }
      setData(next)
      setError('')

      const nextTiktokVideos = tiktokResult.status === 'fulfilled'
        ? (tiktokResult.value.videos || [])
        : []
      const nets = detectNetworks({ ...next, tiktokVideos: nextTiktokVideos })
      if (nets.length && activeNetRef.current !== 'all' && !nets.includes(activeNetRef.current)) setActiveNet(nets[0])

      setLastUpdated(new Date())
    } else {
      setError(analyticsResult.reason?.message || 'Não foi possível consultar as métricas.')
    }

    if (tiktokResult.status === 'fulfilled') {
      const result = tiktokResult.value
      setTiktokVideos(result.videos || [])
      setSourceErrors(current => current.filter(issue => issue.source !== 'TikTok'))
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        const message = result.errors.map(issue => issue.message).filter(Boolean).join(' · ')
        if (message) setSourceErrors(current => [
          ...current.filter(issue => issue.source !== 'TikTok'),
          { source: 'TikTok', message },
        ])
      }
    } else {
      setTiktokVideos([])
      setSourceErrors(current => current.some(issue => issue.source === 'TikTok')
        ? current
        : [...current, { source: 'TikTok', message: tiktokResult.reason?.message || 'Não foi possível consultar os vídeos.' }])
    }

    setLoading(false)
  }, [periodDays, comparePeriod])

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
    loading, error, sourceErrors, lastUpdated,
    setActiveTab, setPeriodDays, selectNetwork, reload: loadAnalytics,
  }
}
