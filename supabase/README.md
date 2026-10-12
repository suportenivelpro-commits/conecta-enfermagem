# Alterações do banco

Estes scripts documentam as alterações já aplicadas ao Supabase conectado ao projeto.
O deploy da Vercel não executa SQL automaticamente. Não reaplique os scripts em um
banco já atualizado: os scripts de cateter e curativo adicionam colunas e funções.

Para uma instalação nova que já tenha as tabelas e RPCs originais, a ordem é:

1. `register_connector_exchange.sql`: permite trocas no mesmo dia.
2. `catheter-management.sql`: data de instalação e troca do cateter.
3. `dressing-management.sql`: curativos de 1, 3 ou 7 dias.
4. `professional-management.sql`: profissionais e senha de confirmação das trocas.

O painel de profissionais é restrito ao UUID da conta existente
`enfa.raquelbrito@gmail.com`, com perfil ativo. Não cria contas no Supabase Auth.
As senhas são hashes bcrypt no schema privado, sem leitura pela API. A administradora
pode cadastrar, editar, desativar e redefinir senhas; não pode consultar a senha atual.
Cinco erros bloqueiam a confirmação por cinco minutos; redefinir a senha remove o bloqueio.
O histórico mantém o nome no momento da troca e acrescenta o identificador do profissional.

A nova RPC `confirm_professional_exchange` valida a senha e chama as implementações
existentes de troca. O script remove a execução direta das quatro RPCs antigas de troca
por `authenticated`, evitando contornar a senha. Cadastro de paciente, alta e login permanecem
com as regras existentes. Para publicar sem interromper a versão anterior, crie primeiro
as tabelas e funções, publique o frontend e aplique as quatro revogações ao confirmar o deploy.
Não reaplique o script completo: ele não é idempotente.

`register_connector_exchange.before.sql` é uma cópia da função anterior para
referência e reversão deliberada; não faz parte da sequência de instalação.

Os scripts `test-*.sql` usam pacientes descartáveis em transações encerradas com
`ROLLBACK`. Exigem as tabelas existentes e um perfil profissional ativo. Não
executam alta nem troca em pacientes reais.

Validações do frontend, a partir da raiz do projeto:

```sh
node tests/exchanges.cjs
node tests/dressing-deadlines.cjs
npm run build
```
