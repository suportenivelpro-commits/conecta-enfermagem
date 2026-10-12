# Alterações do banco

Estes scripts documentam as alterações já aplicadas ao Supabase conectado ao projeto.
O deploy da Vercel não executa SQL automaticamente. Não reaplique os scripts em um
banco já atualizado: os scripts de cateter e curativo adicionam colunas e funções.

Para uma instalação nova que já tenha as tabelas e RPCs originais, a ordem é:

1. `register_connector_exchange.sql`: permite trocas no mesmo dia.
2. `catheter-management.sql`: data de instalação e troca do cateter.
3. `dressing-management.sql`: curativos de 1, 3 ou 7 dias.

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
