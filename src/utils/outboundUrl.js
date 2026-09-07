const dns = require('dns').promises
const net = require('net')
const { Agent } = require('undici')

function ipv4ToNumber(value) {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function mappedIpv4FromIpv6(value) {
  const normalized = String(value || '').toLowerCase()
  const suffix = normalized.startsWith('::ffff:')
    ? normalized.slice('::ffff:'.length)
    : normalized.startsWith('0:0:0:0:0:ffff:')
      ? normalized.slice('0:0:0:0:0:ffff:'.length)
      : null
  if (!suffix) return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix
  const parts = suffix.split(':')
  if (parts.length !== 2 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const high = Number.parseInt(parts[0], 16)
  const low = Number.parseInt(parts[1], 16)
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

function isPrivateIp(address) {
  const normalized = String(address || '').toLowerCase().replace(/^\[|\]$/g, '')
  const family = net.isIP(normalized)
  if (family === 4) {
    const value = ipv4ToNumber(normalized)
    if (value === null) return true
    const ranges = [
      [0x00000000, 0x00ffffff], // 0.0.0.0/8
      [0x0a000000, 0x0affffff], // 10.0.0.0/8
      [0x64400000, 0x647fffff], // 100.64.0.0/10
      [0x7f000000, 0x7fffffff], // 127.0.0.0/8
      [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16
      [0xac100000, 0xac1fffff], // 172.16.0.0/12
      [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
      [0xc0000000, 0xc00000ff], // 192.0.0.0/24
      [0xc6120000, 0xc613ffff], // 198.18.0.0/15
      [0xe0000000, 0xffffffff], // multicast/reserved
    ]
    return ranges.some(([start, end]) => value >= start && value <= end)
  }
  if (family === 6) {
    // IPv4-mapped IPv6 pode contornar uma lista que só testa family === 4.
    // Reaplica exatamente as mesmas faixas privadas ao sufixo IPv4.
    const mappedIpv4 = mappedIpv4FromIpv6(normalized)
    if (mappedIpv4) return isPrivateIp(mappedIpv4)
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('ff')
  }
  return true
}

async function resolveOutboundHttpsUrl(value) {
  let parsed
  try { parsed = new URL(String(value || '')) } catch { throw new Error('URL de destino inválida') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    throw new Error('O destino precisa ser HTTPS sem credenciais embutidas')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname || ['localhost', 'localhost.localdomain', 'ip6-localhost', 'metadata.google.internal'].includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Destino de rede interna não permitido')
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) throw new Error('Destino de rede privada não permitido')

  let addresses
  try { addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true }) } catch {
    throw new Error('Não foi possível validar o host de destino')
  }
  if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) {
    throw new Error('Destino resolve para rede privada ou reservada')
  }
  return { url: parsed.toString(), address: addresses[0].address, family: addresses[0].family || net.isIP(addresses[0].address) }
}

async function validateOutboundHttpsUrl(value) {
  return (await resolveOutboundHttpsUrl(value)).url
}

// A validação DNS precisa usar o mesmo endereço que a conexão usará. Se o
// fetch resolvesse o hostname novamente, um DNS controlado pelo atacante
// poderia responder com IP público na validação e IP privado na conexão
// (DNS rebinding). O dispatcher fixa o resultado público validado, mantendo o
// hostname original para SNI/certificado HTTPS.
async function prepareOutboundHttpsRequest(value) {
  const resolved = await resolveOutboundHttpsUrl(value)
  const dispatcher = new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, resolved.address, resolved.family)
      },
    },
  })
  return {
    url: resolved.url,
    dispatcher,
    close: () => dispatcher.close(),
  }
}

module.exports = { isPrivateIp, validateOutboundHttpsUrl, prepareOutboundHttpsRequest }
