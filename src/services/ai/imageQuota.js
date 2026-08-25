const pool = require('../../db/pool')
const { getPlan, getPlanImageLimit, normalizePlan } = require('../../config/plans')

const IMAGE_QUOTA_CODE = 'AI_IMAGE_LIMIT_REACHED'

const IMAGE_QUOTA_MESSAGES = Object.freeze({
  basico: 'Você atingiu o limite de 10 imagens geradas pela assistente de IA do plano EcooMidia Básico neste mês. O limite será renovado no próximo ciclo; enquanto isso, você ainda pode criar ideias e textos ou fazer upgrade para gerar mais imagens.',
  pro: 'Você atingiu o limite de 15 imagens geradas pela assistente de IA do plano EcooMidia Pro neste mês. O limite será renovado no próximo ciclo; faça upgrade para o EcooMidia Premium se precisar gerar mais imagens agora.',
  premium: 'Você atingiu o limite de 20 imagens geradas pela assistente de IA do plano EcooMidia Premium neste mês. O limite será renovado no próximo ciclo; enquanto isso, você ainda pode criar ideias e textos.',
})

function usageMonth(date = new Date()) {
  const current = new Date(date)
  if (Number.isNaN(current.getTime())) return usageMonth()
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function imageQuotaError(plan) {
  const normalizedPlan = normalizePlan(plan)
  const limit = getPlanImageLimit(normalizedPlan)
  const error = new Error(IMAGE_QUOTA_MESSAGES[normalizedPlan] || `Você atingiu o limite de ${limit} imagens geradas pela assistente de IA neste mês.`)
  error.status = 429
  error.statusCode = 429
  error.code = IMAGE_QUOTA_CODE
  error.plan = normalizedPlan
  error.limit = limit
  return error
}

async function reserveAiImage({ userId, plan, unrestricted = false, now = new Date() }) {
  if (unrestricted) return { reserved: false, unlimited: true, month: null, used: null, limit: null }

  const normalizedPlan = normalizePlan(plan)
  const limit = getPlanImageLimit(normalizedPlan)
  const month = usageMonth(now)
  const { rows: [row] } = await pool.query(`
    INSERT INTO ai_image_usage (user_id, usage_month, images_used)
    VALUES ($1, $2, 1)
    ON CONFLICT (user_id, usage_month) DO UPDATE SET
      images_used = ai_image_usage.images_used + 1
    WHERE ai_image_usage.images_used < $3
    RETURNING images_used
  `, [userId, month, limit])

  if (!row) throw imageQuotaError(normalizedPlan)

  return {
    reserved: true,
    unlimited: false,
    month,
    used: Number(row.images_used),
    limit,
    remaining: Math.max(limit - Number(row.images_used), 0),
    plan: normalizedPlan,
    planName: getPlan(normalizedPlan).name,
  }
}

async function releaseAiImage(reservation, userId) {
  if (!reservation?.reserved || !reservation.month) return
  await pool.query(`
    UPDATE ai_image_usage
    SET images_used = GREATEST(images_used - 1, 0)
    WHERE user_id = $1 AND usage_month = $2
  `, [userId, reservation.month])
}

module.exports = { IMAGE_QUOTA_CODE, IMAGE_QUOTA_MESSAGES, usageMonth, imageQuotaError, reserveAiImage, releaseAiImage }
