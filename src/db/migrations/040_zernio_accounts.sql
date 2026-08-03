-- Guarda o accountId do Zernio (docs.zernio.com) para contas de Facebook/
-- Instagram/TikTok migradas para a integração via Zernio — o Zernio é quem
-- passa a deter o token OAuth real dessas contas; nosso lado só precisa
-- desse identificador para chamar a API deles. Contas ainda na integração
-- OAuth direta antiga (ou no YouTube, que não migra) ficam com esta coluna
-- NULL. Ver src/infra/social/zernioClient.js.
ALTER TABLE contas ADD COLUMN IF NOT EXISTS zernio_account_id TEXT;
