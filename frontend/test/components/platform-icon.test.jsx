import { render } from '@testing-library/react'
import { PlatformIcon } from '../../src/components/ui/platform-icon.jsx'

describe('PlatformIcon', () => {
  it('renders an svg for a known platform, case-insensitively', () => {
    const { container } = render(<PlatformIcon platform="Instagram" />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders nothing for an unknown platform', () => {
    const { container } = render(<PlatformIcon platform="myspace" />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('renders nothing when no platform is given', () => {
    const { container } = render(<PlatformIcon />)
    expect(container.firstChild).toBeNull()
  })
})
