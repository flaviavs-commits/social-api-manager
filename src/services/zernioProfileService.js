// Provisiona o perfil remoto de cada cliente. Este detalhe é deliberadamente
// restrito ao backend: a aplicação só expõe suas próprias contas e fluxos.
const pool = require('../db/pool')
const zernioClient = require('../infra/social/zernioClient')

function profileIdFromResponse(response) {
  const profile = response?.profile || response?.data?.profile || response?.data || response
  return profile?._id || profile?.id || profile?.profileId || null
}

function profilesFromResponse(response) {
  const profiles = response?.profiles || response?.data?.profiles || response?.data || response
  return Array.isArray(profiles) ? profiles : []
}

async function findProfileByName(name) {
  const response = await zernioClient.listProfiles()
  return profilesFromResponse(response).find(profile => String(profile?.name || '') === name) || null
}

async function createOrRecoverProfile(name, email) {
  try {
    const response = await zernioClient.createProfile({
      name,
      description: email || undefined
    })
    const profileId = profileIdFromResponse(response)
    if (profileId) return profileId
    throw new Error('A API de conexão não retornou o identificador do perfil')
  } catch (error) {
    // Se a requisição criou o perfil, mas sofreu timeout antes da resposta, a
    // listagem recupera o mesmo perfil determinístico sem criar outro.
    const existing = await findProfileByName(name).catch(() => null)
    const profileId = profileIdFromResponse(existing)
    if (profileId) return profileId
    throw error
  }
}

async function ensureZernioProfile(userId) {
  if (!userId) throw new Error('Cliente não identificado para criar o perfil de conexão')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [user] } = await client.query(`
      SELECT id, email, zernio_profile_id AS "zernioProfileId"
        FROM users
       WHERE id = $1 AND ativo = TRUE
       FOR UPDATE
    `, [userId])

    if (!user) throw new Error('Cliente não encontrado ou inativo')
    if (user.zernioProfileId) {
      await client.query('COMMIT')
      return user.zernioProfileId
    }

    const profileId = await createOrRecoverProfile(`customer_${user.id}`, user.email)
    const { rows: [saved] } = await client.query(`
      UPDATE users
         SET zernio_profile_id = $1
       WHERE id = $2 AND ativo = TRUE
         AND zernio_profile_id IS NULL
       RETURNING zernio_profile_id AS "zernioProfileId"
    `, [profileId, user.id])

    if (!saved?.zernioProfileId) {
      const current = await client.query('SELECT zernio_profile_id AS "zernioProfileId" FROM users WHERE id = $1', [user.id])
      if (current.rows[0]?.zernioProfileId) {
        await client.query('COMMIT')
        return current.rows[0].zernioProfileId
      }
      throw new Error('Não foi possível salvar o perfil de conexão do cliente')
    }

    await client.query('COMMIT')
    return saved.zernioProfileId
  } catch (error) {
    try { await client.query('ROLLBACK') } catch {}
    throw error
  } finally {
    client.release()
  }
}

async function bestEffortEnsureZernioProfile(userId) {
  try {
    return await ensureZernioProfile(userId)
  } catch {
    return null
  }
}

module.exports = { ensureZernioProfile, bestEffortEnsureZernioProfile, profileIdFromResponse, profilesFromResponse }
