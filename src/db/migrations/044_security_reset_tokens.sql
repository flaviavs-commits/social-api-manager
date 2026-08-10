-- Segurança: tokens de recuperação passaram a ser armazenados como hash
-- SHA-256 com prefixo `sha256:` pelo credentialsRepository.
--
-- Tokens antigos eram armazenados em claro e não podem ser convertidos de
-- forma reversível com segurança. Invalidá-los evita que um backup/log antigo
-- continue permitindo troca de senha após a implantação do hardening.
UPDATE credentials
   SET reset_token = NULL,
       reset_token_expires = NULL
 WHERE reset_token IS NOT NULL;

