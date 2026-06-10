const { Router } = require('express')
const repo = require('../repositories/postsRepository')

const router = Router()

// GET /api/posts
router.get('/', async (req, res) => {
  try {
    const posts = await repo.listarPosts(req.query)
    res.json({ posts })
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

// POST /api/posts
router.post('/', async (req, res) => {
  try {
    const { text, platforms, group, scheduledAt, repeat } = req.body
    if (!text || !platforms?.length || !scheduledAt)
      return res.status(400).json({ erro: 'text, platforms e scheduledAt são obrigatórios' })

    const post = await repo.criarPost({ text, platforms, group_name: group, scheduledAt, repeat })
    res.status(201).json(post)
  } catch (e) {
    res.status(400).json({ erro: e.message })
  }
})

// DELETE /api/posts/:id
router.delete('/:id', async (req, res) => {
  try {
    const ok = await repo.deletarPost(Number(req.params.id))
    if (!ok) return res.status(404).json({ erro: 'Post não encontrado ou já publicado' })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ erro: e.message })
  }
})

module.exports = router