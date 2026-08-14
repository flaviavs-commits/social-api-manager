const PDFDocument = require('pdfkit')

const COLORS = {
  ink: '#172033',
  inkSoft: '#243149',
  muted: '#667085',
  gold: '#D9A441',
  goldLight: '#F8EFD8',
  cream: '#FCFAF6',
  line: '#E6E8EC',
  white: '#FFFFFF',
  green: '#16805C',
  greenLight: '#E8F5EF',
  red: '#C0392B',
  redLight: '#FCECEA',
  blue: '#2F6FED',
  blueLight: '#EAF0FF'
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeZone: 'America/Sao_Paulo'
  }).format(value)
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0)
}

function normalizeRows(rows = []) {
  return rows.map(row => ({ status: String(row.status || 'outro'), count: Number(row.count) || 0 }))
}

function statusLabel(status) {
  const labels = {
    published: 'Publicadas',
    scheduled: 'Agendadas',
    processing: 'Em processamento',
    error: 'Com erro',
    partial: 'Parciais',
    draft: 'Rascunhos'
  }
  return labels[status] || status
}

function platformLabel(platform) {
  const labels = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' }
  return labels[platform] || platform || 'Outra rede'
}

function statusColor(status) {
  if (status === 'published') return COLORS.green
  if (status === 'error') return COLORS.red
  if (status === 'scheduled') return COLORS.blue
  return COLORS.muted
}

function statusBackground(status) {
  if (status === 'published') return COLORS.greenLight
  if (status === 'error') return COLORS.redLight
  if (status === 'scheduled') return COLORS.blueLight
  return '#F1F3F6'
}

function normalizePlatformRows(rows = []) {
  return rows
    .map(row => ({ platform: String(row.platform || 'outra'), count: Number(row.count) || 0 }))
    .filter(row => row.count > 0)
}

function normalizePostRows(rows = []) {
  return rows.map(row => ({
    id: row.id,
    text: String(row.text || 'Publicação sem texto').replace(/\s+/g, ' ').trim(),
    status: String(row.status || 'outro'),
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    occurredAt: row.occurred_at || row.occurredAt || null
  }))
}

function truncateText(value, maxLength = 260) {
  const text = String(value || '').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

function roundedCard(doc, x, y, width, height, fill = COLORS.white, radius = 10) {
  doc.save().roundedRect(x, y, width, height, radius).fillAndStroke(fill, COLORS.line).restore()
}

function drawFooter(doc, pageWidth, pageHeight, margin, pageNumber) {
  doc.strokeColor(COLORS.line).moveTo(margin, pageHeight - 55).lineTo(pageWidth - margin, pageHeight - 55).stroke()
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text('Relatório gerado automaticamente pelo Meu Ecoo Mídia', margin, pageHeight - 40)
  doc.text(`Página ${pageNumber}`, pageWidth - margin - 55, pageHeight - 40, { width: 55, align: 'right' })
}

function drawSectionHeading(doc, title, subtitle, x, y, width) {
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text(title, x, y)
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(subtitle, x, y + 24, { width })
}

function drawStatCard(doc, card, x, y, width, height) {
  roundedCard(doc, x, y, width, height, COLORS.white)
  doc.save().roundedRect(x, y, width, 5, 3).fill(card.color).restore()
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(card.label, x + 13, y + 20, { width: width - 26 })
  doc.fillColor(card.color).font('Helvetica-Bold').fontSize(25).text(formatNumber(card.value), x + 13, y + 43)
}

function drawStatusPill(doc, label, status, x, y) {
  const color = statusColor(status)
  doc.font('Helvetica-Bold').fontSize(8)
  const width = Math.max(54, doc.widthOfString(label) + 18)
  doc.save().roundedRect(x, y, width, 18, 9).fill(statusBackground(status)).restore()
  doc.fillColor(color).font('Helvetica-Bold').fontSize(8).text(label, x + 9, y + 5, { width: width - 18, align: 'center' })
}

function drawPercentage(doc, percentage, x, y, width) {
  const value = Math.max(0, Math.min(100, percentage))
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text(`${value.toFixed(1).replace('.', ',')}%`, x, y, { width, align: 'right' })
  doc.save().roundedRect(x, y + 17, width, 4, 2).fill('#EEF0F3').restore()
  if (value > 0) doc.save().roundedRect(x, y + 17, width * value / 100, 4, 2).fill(COLORS.gold).restore()
}

function gerarRelatorioPdf({ name, periodDays, rows = [], platformRows = [], postRows = [], generatedAt = new Date(), platform = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: name, Author: 'Meu Ecoo Mídia', Subject: 'Relatório operacional' } })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const normalizedRows = normalizeRows(rows)
    const normalizedPlatformRows = normalizePlatformRows(platformRows)
    const normalizedPostRows = normalizePostRows(postRows)
    const total = normalizedRows.reduce((sum, row) => sum + row.count, 0)
    const published = normalizedRows.find(row => row.status === 'published')?.count || 0
    const errors = normalizedRows.filter(row => ['error', 'partial'].includes(row.status)).reduce((sum, row) => sum + row.count, 0)
    const scheduled = normalizedRows.find(row => row.status === 'scheduled')?.count || 0
    const platformText = platform ? platformLabel(platform) : 'Todas as plataformas'
    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const margin = 42
    const contentWidth = pageWidth - margin * 2

    // Página 1: resumo executivo
    doc.rect(0, 0, pageWidth, 154).fill(COLORS.ink)
    doc.rect(0, 0, 8, 154).fill(COLORS.gold)
    doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(11).text('MEU ECOO MÍDIA', margin, 32, { characterSpacing: 1.5 })
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(24).text(truncateText(name || 'Relatório operacional', 48), margin, 58, { width: contentWidth - 120, lineBreak: false })
    doc.fillColor('#CBD2E0').font('Helvetica').fontSize(10).text(`Gerado em ${formatDate(generatedAt)}  ·  janela de ${periodDays} dias`, margin, 103)
    doc.fillColor('#CBD2E0').font('Helvetica').fontSize(9).text(platformText, margin, 121)
    doc.circle(pageWidth - 72, 72, 26).fill(COLORS.gold)
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text('ME', pageWidth - 88, 63, { width: 32, align: 'center' })

    drawSectionHeading(doc, 'Visão geral', 'Um retrato rápido da operação no período selecionado.', margin, 188, contentWidth)
    const cards = [
      { label: 'Conteúdos no período', value: total, color: COLORS.inkSoft },
      { label: 'Publicados', value: published, color: COLORS.green },
      { label: 'Agendados', value: scheduled, color: COLORS.blue },
      { label: 'Com atenção', value: errors, color: COLORS.red }
    ]
    const gap = 10
    const cardWidth = (contentWidth - gap * 3) / 4
    cards.forEach((card, index) => drawStatCard(doc, card, margin + index * (cardWidth + gap), 242, cardWidth, 88))

    const tableY = 371
    drawSectionHeading(doc, 'Distribuição por status', 'Quantidade de publicações criadas durante a janela do relatório.', margin, tableY, contentWidth)
    const tableTop = tableY + 58
    const statusWidth = contentWidth * 0.51
    const countWidth = contentWidth * 0.19
    const shareWidth = contentWidth - statusWidth - countWidth
    roundedCard(doc, margin, tableTop, contentWidth, 31, COLORS.goldLight, 6)
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8.5).text('STATUS', margin + 14, tableTop + 10)
    doc.text('VOLUME', margin + statusWidth, tableTop + 10, { width: countWidth - 14, align: 'right' })
    doc.text('PARTICIPAÇÃO', margin + statusWidth + countWidth, tableTop + 10, { width: shareWidth - 14, align: 'right' })

    const tableRows = normalizedRows.length ? normalizedRows : [{ status: 'none', count: 0 }]
    const tableRowHeight = 36
    tableRows.forEach((row, index) => {
      const y = tableTop + 31 + index * tableRowHeight
      if (index % 2 === 0) doc.rect(margin, y, contentWidth, tableRowHeight).fill(COLORS.cream)
      const label = row.status === 'none' ? 'Nenhuma publicação' : statusLabel(row.status)
      drawStatusPill(doc, label, row.status, margin + 14, y + 9)
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(formatNumber(row.count), margin + statusWidth, y + 12, { width: countWidth - 14, align: 'right' })
      drawPercentage(doc, total ? row.count / total * 100 : 0, margin + statusWidth + countWidth + 10, y + 6, shareWidth - 20)
      doc.strokeColor(COLORS.line).moveTo(margin, y + tableRowHeight).lineTo(margin + contentWidth, y + tableRowHeight).stroke()
    })

    const noteY = tableTop + 31 + tableRows.length * tableRowHeight + 24
    roundedCard(doc, margin, noteY, contentWidth, 64, COLORS.ink, 10)
    doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(8.5).text('PRÓXIMO PASSO', margin + 17, noteY + 15, { characterSpacing: 0.6 })
    doc.fillColor(COLORS.white).font('Helvetica').fontSize(9.5).text(errors ? 'Revise os conteúdos com erro ou status parcial antes do próximo ciclo.' : 'A operação não apresenta falhas registradas no período.', margin + 17, noteY + 32, { width: contentWidth - 34 })
    drawFooter(doc, pageWidth, pageHeight, margin, 1)

    if (normalizedPlatformRows.length || normalizedPostRows.length) {
      let pageNumber = 2
      let detailY = 0

      const startDetailPage = () => {
        doc.addPage()
        doc.rect(0, 0, pageWidth, 122).fill(COLORS.ink)
        doc.rect(0, 0, 8, 122).fill(COLORS.gold)
        doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(10).text('MEU ECOO MÍDIA', margin, 27, { characterSpacing: 1.5 })
        doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(21).text('Detalhamento operacional', margin, 50)
        doc.fillColor('#CBD2E0').font('Helvetica').fontSize(9).text(`Informações consolidadas do período  ·  ${periodDays} dias`, margin, 84)
        detailY = 153
      }

      const finishPage = () => drawFooter(doc, pageWidth, pageHeight, margin, pageNumber)
      const ensureSpace = (height) => {
        if (detailY + height <= pageHeight - 76) return
        finishPage()
        pageNumber += 1
        startDetailPage()
      }

      startDetailPage()

      if (normalizedPlatformRows.length) {
        drawSectionHeading(doc, 'Distribuição por rede', 'Quantidade de conteúdos associados a cada plataforma.', margin, detailY, contentWidth)
        detailY += 57
        const platformGap = 10
        const platformWidth = (contentWidth - platformGap) / 2
        normalizedPlatformRows.forEach((row, index) => {
          const column = index % 2
          const line = Math.floor(index / 2)
          const x = margin + column * (platformWidth + platformGap)
          const y = detailY + line * 62
          roundedCard(doc, x, y, platformWidth, 50, COLORS.white, 9)
          doc.fillColor(COLORS.gold).circle(x + 18, y + 25, 5)
          doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(platformLabel(row.platform), x + 32, y + 15)
          doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(16).text(formatNumber(row.count), x + platformWidth - 58, y + 13, { width: 42, align: 'right' })
        })
        detailY += Math.ceil(normalizedPlatformRows.length / 2) * 62 + 22
      }

      if (normalizedPostRows.length) {
        ensureSpace(88)
        drawSectionHeading(doc, 'Publicações do período', 'As publicações mais recentes aparecem com status, redes e data de referência.', margin, detailY, contentWidth)
        detailY += 57
        normalizedPostRows.forEach((row, index) => {
          const displayText = truncateText(row.text)
          doc.font('Helvetica-Bold').fontSize(10)
          const textHeight = doc.heightOfString(displayText, { width: contentWidth - 54 })
          const rowHeight = Math.min(112, Math.max(64, textHeight + 43))
          ensureSpace(rowHeight + 10)
          const platformsText = row.platforms.map(platformLabel).join('  ·  ') || 'Rede não informada'
          const dateText = row.occurredAt ? formatDate(new Date(row.occurredAt)) : 'Data não informada'
          const x = margin
          const y = detailY
          roundedCard(doc, x, y, contentWidth, rowHeight, index % 2 === 0 ? COLORS.white : COLORS.cream, 9)
          doc.save().roundedRect(x, y, 6, rowHeight, 3).fill(statusColor(row.status)).restore()
          doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10).text(displayText, x + 18, y + 13, { width: contentWidth - 36, height: rowHeight - 38 })
          drawStatusPill(doc, statusLabel(row.status), row.status, x + 18, y + rowHeight - 28)
          doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(`${platformsText}  ·  ${dateText}`, x + 104, y + rowHeight - 23, { width: contentWidth - 122 })
          detailY += rowHeight + 10
        })
      }
      finishPage()
    }
    doc.end()
  })
}

module.exports = { gerarRelatorioPdf, formatDate, normalizeRows, normalizePlatformRows, normalizePostRows }
