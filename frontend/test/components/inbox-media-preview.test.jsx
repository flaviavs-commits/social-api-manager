import { fireEvent, render, screen } from '@testing-library/react'
import { InboxMediaPreview } from '../../src/pages/inbox-page.jsx'

describe('InboxMediaPreview', () => {
  it('prioriza o poster de vídeo em vez do ícone de play', () => {
    render(<InboxMediaPreview media={{ type: 'video', source: 'video.mp4', thumbnail: 'poster.jpg' }} />)

    expect(screen.getByAltText('Prévia da publicação')).toHaveAttribute('src', 'poster.jpg')
  })

  it('usa a fonte da imagem quando a primeira prévia falha', () => {
    render(<InboxMediaPreview media={{ type: 'image', source: 'image.jpg', thumbnail: 'thumbnail.jpg' }} />)

    const preview = screen.getByAltText('Prévia da publicação')
    fireEvent.error(preview)
    expect(screen.getByAltText('Prévia da publicação')).toHaveAttribute('src', 'image.jpg')
  })
})
