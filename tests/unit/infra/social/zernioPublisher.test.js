jest.mock('../../../../src/infra/social/zernioClient', () => ({
  createPost: jest.fn()
}))

jest.mock('../../../../src/infra/social/mediaFetch', () => ({
  mediaUrl: jest.fn(path => `https://cdn.test/${path}`)
}))

const zernioClient = require('../../../../src/infra/social/zernioClient')
const { publicarZernioInstagram, publicarZernioFacebook, publicarZernioTiktok } = require('../../../../src/infra/social/zernioPublisher')

function zernioResponse() {
  return {
    post: {
      _id: 'z-post-1',
      platforms: [{ platform: 'tiktok', platformPostId: 'tt-post-1', platformPostUrl: 'https://tiktok.com/@user/post/1' }]
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  zernioClient.createPost.mockResolvedValue(zernioResponse())
})

test('publica carrossel de fotos com tiktokSettings conforme a API do Zernio', async () => {
  const post = await publicarZernioTiktok(
    { accessToken: 'zernio-account-1' },
    {
      mediaItems: [
        { path: 'photo-1.jpg', type: 'image' },
        { path: 'photo-2.jpg', type: 'image' }
      ],
      titleByPlatform: { tiktok: 'Minha viagem' },
      textByPlatform: { tiktokDescription: 'Os melhores momentos da viagem #travel' },
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
      tiktokDisableComment: false,
      tiktokDisableDuet: true,
      tiktokDisableStitch: true
    },
    { requestId: 'request-1' }
  )

  expect(zernioClient.createPost).toHaveBeenCalledWith({
    content: 'Minha viagem',
    publishNow: true,
    mediaItems: [
      { type: 'image', url: 'https://cdn.test/photo-1.jpg' },
      { type: 'image', url: 'https://cdn.test/photo-2.jpg' }
    ],
    platforms: [{ platform: 'tiktok', accountId: 'zernio-account-1' }],
    tiktokSettings: {
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true,
      content_preview_confirmed: true,
      express_consent_given: true,
      media_type: 'photo',
      photo_cover_index: 0,
      description: 'Os melhores momentos da viagem #travel'
    }
  }, { requestId: 'request-1' })
  expect(post).toMatchObject({ platformPostId: 'tt-post-1', platformPostUrl: 'https://tiktok.com/@user/post/1' })
})

test('mantém o vídeo como mídia única e envia as opções específicas de vídeo', async () => {
  await publicarZernioTiktok(
    { accessToken: 'zernio-account-1' },
    {
      mediaItems: [{ path: 'video.mp4', type: 'video' }],
      text: 'Descrição do vídeo',
      tiktokPrivacyLevel: 'SELF_ONLY',
      tiktokDisableComment: true,
      tiktokDisableDuet: false,
      tiktokDisableStitch: true
    }
  )

  const body = zernioClient.createPost.mock.calls[0][0]
  expect(body.content).toBe('Descrição do vídeo')
  expect(body.tiktokSettings).toEqual({
    privacy_level: 'SELF_ONLY',
    allow_comment: false,
    content_preview_confirmed: true,
    express_consent_given: true,
    allow_duet: true,
    allow_stitch: false
  })
})

test('envia metadata para correlacionar o webhook com a publicação local', async () => {
  const metadata = {
    app: 'social-api-manager',
    clienteId: '7',
    postId: '303',
    postAccountId: '9',
    platform: 'tiktok'
  }

  await publicarZernioTiktok(
    { accessToken: 'zernio-account-1' },
    {
      mediaItems: [{ path: 'photo.jpg', type: 'image' }],
      text: 'Uma foto',
      tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE'
    },
    { metadata }
  )

  expect(zernioClient.createPost.mock.calls[0][0].metadata).toEqual(metadata)
})

test('identifica vídeo do Instagram sem enviar contentType feed', async () => {
  zernioClient.createPost.mockResolvedValue({
    post: {
      _id: 'ig-post-1',
      platforms: [{ platform: 'instagram', platformPostId: 'ig-post-1', platformPostUrl: 'https://instagram.com/reel/1' }]
    }
  })

  await publicarZernioInstagram(
    { accessToken: 'instagram-account-1' },
    { mediaItems: [{ path: 'video.mp4', type: 'video' }], text: 'Vídeo', igFormat: 'post' }
  )

  const body = zernioClient.createPost.mock.calls[0][0]
  expect(body.mediaItems).toEqual([{ type: 'video', url: 'https://cdn.test/video.mp4' }])
  expect(body.platforms[0]).toEqual({
    platform: 'instagram',
    accountId: 'instagram-account-1',
    platformSpecificData: { shareToFeed: true }
  })
  expect(body.platforms[0].platformSpecificData.contentType).toBeUndefined()
})

test('usa contentType story somente para story do Instagram', async () => {
  zernioClient.createPost.mockResolvedValue({
    post: {
      _id: 'ig-story-1',
      platforms: [{ platform: 'instagram', platformPostId: 'ig-story-1' }]
    }
  })

  await publicarZernioInstagram(
    { accessToken: 'instagram-account-1' },
    { mediaItems: [{ path: 'story.mp4', type: 'video' }], text: 'Story', igFormat: 'story' }
  )

  expect(zernioClient.createPost.mock.calls[0][0].platforms[0].platformSpecificData).toEqual({ contentType: 'story' })
})

test('envia Facebook Reel como contentType reel', async () => {
  zernioClient.createPost.mockResolvedValue({
    post: {
      _id: 'fb-reel-1',
      platforms: [{ platform: 'facebook', platformPostId: 'fb-reel-1' }]
    }
  })

  await publicarZernioFacebook(
    { accessToken: 'facebook-account-1' },
    { mediaItems: [{ path: 'reel.mp4', type: 'video' }], text: 'Reel', facebookFormat: 'reel' }
  )

  expect(zernioClient.createPost.mock.calls[0][0].platforms[0].platformSpecificData).toEqual({ contentType: 'reel' })
})
