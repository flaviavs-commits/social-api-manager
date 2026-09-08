const { Router } = require('express')
const pool = require('../db/pool')
const { serverError } = require('../utils/http')

const router = Router()

function normalizeFolderName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80)
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT folders.id, folders.name, COUNT(media_assets.id)::int AS "assetCount"
      FROM media_folders folders
      LEFT JOIN media_assets
        ON media_assets.user_id = folders.user_id
       AND media_assets.folder = folders.name
      WHERE folders.user_id = $1
      GROUP BY folders.id, folders.name
      UNION ALL
      SELECT 0 AS id, media_assets.folder AS name, COUNT(*)::int AS "assetCount"
      FROM media_assets
      WHERE media_assets.user_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM media_folders folders
          WHERE folders.user_id = media_assets.user_id
            AND LOWER(folders.name) = LOWER(media_assets.folder)
        )
      GROUP BY media_assets.folder
      ORDER BY name ASC
    `, [req.user.id])
    res.json({ folders: rows })
  } catch (err) { serverError(res, err) }
})

router.post('/', async (req, res) => {
  try {
    const name = normalizeFolderName(req.body?.name)
    if (!name) return res.status(400).json({ erro: 'Informe um nome para a pasta.' })

    // A decisão de existência precisa ser feita pelo mesmo INSERT. Duas
    // requisições simultâneas não podem passar por um SELECT de pré-checagem e
    // criar a mesma pasta; o índice único case-insensitive da migration 051 é
    // a fonte de verdade.
    const { rows } = await pool.query(
      'INSERT INTO media_folders (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name',
      [req.user.id, name]
    )
    if (!rows.length) return res.status(409).json({ erro: 'Essa pasta já existe.' })
    res.status(201).json({ folder: { ...rows[0], assetCount: 0 } })
  } catch (err) { serverError(res, err) }
})

module.exports = router
