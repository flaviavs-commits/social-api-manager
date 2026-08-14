const PDFDocument = require('pdfkit')

const COLORS = {
  ink: '#172033',
  muted: '#667085',
  gold: '#D9A441',
  goldLight: '#F8EFD8',
  line: '#E6E8EC',
  white: '#FFFFFF',
  green: '#16805C',
  red: '#C0392B',
  blue: '#2F6FED'
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeZone: 'America/Sao_Paulo'
  }).format(value)
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

function statusColor(status) {
  if (status === 'published') return COLORS.green
  if (status === 'error') return COLORS.red
  if (status === 'scheduled') return COLORS.blue
  return COLORS.muted
}

function roundedCard(doc, x, y, width, height, fill = COLORS.white) {
  doc.save().roundedRect(x, y, width, height, 10).fillAndStroke(fill, COLORS.line).restore()
}

function gerarRelatorioPdf({ name, periodDays, rows = [], generatedAt = new Date(), platform = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: name, Author: 'Meu Ecoo Mídia', Subject: 'Relatório operacional' } })
    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const normalizedRows = normalizeRows(rows)
    const total = normalizedRows.reduce((sum, row) => sum + row.count, 0)
    const published = normalizedRows.find(row => row.status === 'published')?.count || 0
    const errors = normalizedRows.filter(row => ['error', 'partial'].includes(row.status)).reduce((sum, row) => sum + row.count, 0)
    const scheduled = normalizedRows.find(row => row.status === 'scheduled')?.count || 0
    const platformLabel = platform ? statusLabel(platform) : 'Todas as plataformas'
    const pageWidth = doc.page.width
    const margin = 42
    const contentWidth = pageWidth - margin * 2

    doc.rect(0, 0, pageWidth, 142).fill(COLORS.ink)
    doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(11).text('MEU ECOO MÍDIA', margin, 34, { characterSpacing: 1.5 })
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(25).text(name || 'Relatório operacional', margin, 58, { width: contentWidth - 120 })
    doc.fillColor('#CBD2E0').font('Helvetica').fontSize(10).text(`Gerado em ${formatDate(generatedAt)} · janela de ${periodDays} dias · ${platformLabel}`, margin, 101)
    doc.circle(pageWidth - 72, 67, 25).fill(COLORS.gold)
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text('ME', pageWidth - 88, 58, { width: 32, align: 'center' })

    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text('Visão geral', margin, 177)
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Um retrato rápido da operação no período selecionado.', margin, 201)

    const cards = [
      { label: 'Conteúdos no período', value: total, color: COLORS.ink },
      { label: 'Publicados', value: published, color: COLORS.green },
      { label: 'Agendados', value: scheduled, color: COLORS.blue },
      { label: 'Com atenção', value: errors, color: COLORS.red }
    ]
    const gap = 10
    const cardWidth = (contentWidth - gap * 3) / 4
    cards.forEach((card, index) => {
      const x = margin + index * (cardWidth + gap)
      roundedCard(doc, x, 226, cardWidth, 86)
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(card.label, x + 12, 241, { width: cardWidth - 24 })
      doc.fillColor(card.color).font('Helvetica-Bold').fontSize(25).text(String(card.value), x + 12, 263)
    })

    const tableY = 352
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16).text('Distribuição por status', margin, tableY)
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('Quantidade de publicações criadas durante a janela do relatório.', margin, tableY + 24)

    const tableTop = tableY + 58
    const statusWidth = contentWidth * 0.68
    const countWidth = contentWidth - statusWidth
    doc.roundedRect(margin, tableTop, contentWidth, 30, 6).fill(COLORS.goldLight)
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9).text('STATUS', margin + 14, tableTop + 10)
    doc.text('QUANTIDADE', margin + statusWidth, tableTop + 10, { width: countWidth - 14, align: 'right' })

    const tableRows = normalizedRows.length ? normalizedRows : [{ status: 'none', count: 0 }]
    tableRows.forEach((row, index) => {
      const y = tableTop + 30 + index * 34
      if (index % 2 === 0) doc.rect(margin, y, contentWidth, 34).fill('#FAFBFC')
      doc.fillColor(statusColor(row.status)).circle(margin + 17, y + 17, 4)
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(10).text(row.status === 'none' ? 'Nenhuma publicação' : statusLabel(row.status), margin + 30, y + 11)
      doc.font('Helvetica-Bold').text(String(row.count), margin + statusWidth, y + 11, { width: countWidth - 14, align: 'right' })
      doc.strokeColor(COLORS.line).moveTo(margin, y + 34).lineTo(margin + contentWidth, y + 34).stroke()
    })

    const noteY = tableTop + 30 + tableRows.length * 34 + 28
    roundedCard(doc, margin, noteY, contentWidth, 58, COLORS.ink)
    doc.fillColor(COLORS.gold).font('Helvetica-Bold').fontSize(9).text('PRÓXIMO PASSO', margin + 16, noteY + 14)
    doc.fillColor(COLORS.white).font('Helvetica').fontSize(9.5).text(errors ? 'Revise os conteúdos com erro ou status parcial antes do próximo ciclo.' : 'A operação não apresenta falhas registradas no período.', margin + 16, noteY + 30, { width: contentWidth - 32 })

    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text('Relatório gerado automaticamente pelo Meu Ecoo Mídia', margin, doc.page.height - 38)
    doc.text('Página 1', pageWidth - margin - 50, doc.page.height - 38, { width: 50, align: 'right' })
    doc.end()
  })
}

module.exports = { gerarRelatorioPdf, formatDate, normalizeRows }
