# MICA Hub

CRM para organizar prospecção comercial, pipeline, tarefas, agenda, propostas e financeiro. A versão online usa Supabase Auth e banco privado por usuário. A interface permanece em HTML, CSS e JavaScript; o build empacota a biblioteca oficial do Supabase. Backups HTML continuam funcionando offline.

## Versão online e segurança

- Produção: https://micahub.vercel.app
- Login por Google ou e-mail e senha. Confirmação de e-mail desativada temporariamente por decisão do proprietário.
- Dados em `private.crm_documents`, com RLS forçada e autorização por `auth.uid()`. O schema privado não é exposto na API; apenas `load_crm` e `save_crm` são públicos e exigem sessão autenticada válida.
- Validação da sessão no banco, bloqueio de usuários banidos/anônimos e exigência de segundo fator quando ativado em **Conta**.
- Limites por usuário: 120 leituras e 60 gravações por minuto. Login e verificação: 10 solicitações por 5 minutos/IP no Supabase. Tokens de acesso: 15 minutos; detecção de reutilização de refresh tokens ativada.
- Documento de até 10 MiB por conta, com revisão para impedir sobrescrita silenciosa entre abas. Erros preservam alterações em memória e permitem baixar cópia.
- O navegador guarda a sessão e o tema; os dados online do CRM são carregados em memória. Aguarde **Salvo na nuvem** antes de fechar. Alterações não sincronizadas não sobrevivem a um encerramento forçado; exporte um backup quando estiver sem conexão.
- O build publica somente arquivos permitidos em `dist`; a base local, credenciais, testes e backups não são publicados. CSP bloqueia scripts inline; demais cabeçalhos bloqueiam enquadramento e inferência de tipo de arquivo.
- Apenas a chave **publishable**, própria para uso público, está no frontend. Client Secret do Google fica somente no painel do Supabase.

### Limitações e operação

Sem domínio/remetente SMTP, recuperação de senha por e-mail fica indisponível e não dispara envios. Quando o SMTP for configurado, validar remetente, templates e retorno à produção antes de ativar `emailRecoveryEnabled`. Google continua independente do SMTP.

Sem confirmação de e-mail, o cadastro com senha não comprova a propriedade do endereço. Reativar confirmação assim que o remetente estiver pronto. CAPTCHA e proteção contra senhas vazadas não estão habilitados; a segunda depende da disponibilidade do plano. Rate limiting não substitui esses controles.

Para entrar com Google fora dos usuários de teste, conferir a audiência/publicação do aplicativo no Google Cloud. Manter callback `https://qictnscbhkjcyauucuib.supabase.co/auth/v1/callback` e retorno do app `https://micahub.vercel.app/`.

O armazenamento atual é um documento por usuário para preservar todos os módulos legados. Não é indicado para edição colaborativa ou bases muito grandes. Realizar backups JSON periódicos e planejar recuperação/exportação do banco conforme o plano do Supabase; não há monitoramento externo ou backup agendado configurado por este repositório.

### Desenvolvimento e publicação

```powershell
npm ci
npm run build
npm run dev
npm test
npm run test:security
node tests/security-test.mjs --live
```

`npm run dev` serve apenas `dist` em `http://127.0.0.1:8000`. O login Google retorna à produção; para desenvolvimento isolado, usar um projeto Supabase separado e allowlist explícita, sem liberar URLs arbitrárias em produção. A Vercel executa `npm run build` e publica `dist` pelo `vercel.json`.

Migrações versionadas em `supabase/migrations` já aplicadas ao projeto MICA Hub. `supabase/config.toml` descreve o ambiente local e não altera sozinho a configuração hospedada. Não reaplicar migrações existentes nem colocar segredos nesse arquivo.

Testes em `supabase/tests/security.sql` usam contas e sessões dentro de uma transação finalizada com `ROLLBACK`: validam RLS, conflitos, rate limits e bloqueio de sessões inválidas, sem criar contas permanentes. A suíte JS usa autenticação simulada; o modo `--live` verifica configurações e bloqueios reais sem cadastrar usuários.

## Estrutura

```text
.
├── index.html
├── assets/
│   ├── css/
│   │   ├── variables.css
│   │   ├── app.css
│   │   ├── responsive.css
│   │   └── theme-light.css
│   ├── Logotipo M com Hub Azul-Ciano.png
│   └── js/
│       ├── data.example.js
│       ├── storage.js
│       ├── search.js
│       ├── proposals.js
│       └── app.js
└── tests/
    └── smoke-test.mjs
```

O arquivo principal é `index.html`.

## Como executar

Para uso online ou desenvolvimento, siga os comandos acima. O modo offline legado pode ser aberto por `index.html` diretamente em um navegador moderno e não se conecta ao Supabase.

Em uma instalação nova, copie `assets/js/data.example.js` para `assets/js/data.js`. O arquivo `data.js` é local e ignorado pelo Git para que uma base privada de leads nunca seja versionada. A imagem opcional `assets/mica-portrait.webp`, usada na capa das propostas, também permanece somente no computador local.

Para executar os testes de regressão em uma máquina Windows com Microsoft Edge e Node.js disponíveis:

```powershell
node tests\smoke-test.mjs
```

Node.js é utilizado apenas pela suíte de desenvolvimento; não é requisito para usar o CRM.

## Persistência offline e migração

As informações abaixo se referem exclusivamente ao arquivo aberto com `file://`. Na versão online, não há migração automática da base do navegador para uma conta: entre na conta correta e use **Restaurar JSON** ou **Importar leads** explicitamente. A base local original permanece no computador.

A camada em `assets/js/storage.js` centraliza o acesso ao `localStorage` sem alterar o formato salvo. As chaves existentes foram preservadas:

- `crm_climatizacao_sp_v1`: estado legado, mantido para migração e recuperação;
- `crm_climatizacao_sp_v2`: estado atual com leads, fichas, histórico, tarefas, negociações, segmentos, financeiro, propostas, catálogo, metas, última carteira selecionada, configurações e templates.
- `mica_proposta_modelo_v1`: configuração do antigo gerador isolado, lida somente como origem de migração para preservar os valores já cadastrados.
- `mica-theme`: preferência visual local (`system`, `light` ou `dark`).

O CRM continua migrando automaticamente dados v1 quando necessário. Backups JSON e HTML autocontido permanecem disponíveis pela interface.

O `localStorage` pertence ao perfil do navegador e não é incluído pelo Git. O `.gitignore` protege a base local `assets/js/data.js` e a foto pessoal `assets/mica-portrait.webp`; nenhum dado do navegador é exportado automaticamente para arquivos do projeto.

## Busca de leads

A busca global utiliza um índice em memória separado dos dados persistidos. Ela pesquisa simultaneamente empresa, contato, telefone, WhatsApp, e-mail, cidade, UF, endereço, segmento, etapa, origem, responsável, tags quando existirem, observações, histórico e informações comerciais.

Os termos ignoram acentos, diferenças entre maiúsculas e minúsculas e espaços extras. Palavras digitadas podem estar em campos diferentes do mesmo lead, telefones ignoram formatação e pequenos erros de digitação são tolerados. Correspondências exatas e em nome/empresa recebem maior relevância; observações possuem menor peso.

A busca usa debounce curto e o índice só é reconstruído quando os dados são alterados, não a cada tecla. Em qualquer tela do CRM, uma lista abaixo da barra mostra e refina as combinações enquanto o usuário digita; clicar em uma sugestão abre diretamente a ficha do lead. Na lista e no pipeline, a busca também funciona junto aos filtros e ao tipo de negócio selecionado, mostra a quantidade de resultados e pode ser limpa pelo botão na barra ou pelo resumo dos resultados.

## Propostas comerciais

A área **Propostas** cria, edita, duplica, visualiza e exclui propostas comerciais. Um lead existente pode ser selecionado para preencher automaticamente os dados do cliente. Itens podem vir do catálogo ou ser personalizados na própria proposta; quantidade, valor, desconto, acréscimo, subtotal e total são calculados em tempo real.

Os dados da empresa são reutilizados entre propostas. Cada proposta mantém uma cópia dos seus itens, portanto editar ou excluir um item do catálogo não altera documentos já salvos. A prévia segue o modelo editorial original e o botão **Imprimir / PDF** usa a impressão nativa do navegador com páginas A4 e sem os controles do CRM.

A área **Serviços / Produtos** oferece cadastro, edição, ativação, desativação, exclusão, busca e filtros. Propostas, empresa, catálogo e numeração automática ficam dentro de `proposals` no estado v2 e participam dos backups e restaurações.

O serviço principal `Criação de site institucional` é a referência de valor potencial para leads que ainda não possuem proposta ou negociação informada. Quando existe uma proposta vinculada ao lead, o total real da proposta passa a alimentar o pipeline e o dashboard; valores negociados e fechados continuam tendo prioridade. Propostas já salvas mantêm seus valores históricos quando o catálogo é editado.

## Financeiro

O módulo Financeiro registra receitas e despesas no próprio estado v2. Cada lançamento possui identificador, tipo, categoria, valor numérico, data, descrição, observações e datas de criação/atualização. Indicadores, tabela, filtros, resumo por categoria e gráfico são calculados diretamente desses lançamentos.

Ao confirmar um lead como `Fechado`, o valor da venda gera automaticamente uma receita na categoria `Venda`, vinculada ao lead por `source: "closed_deal"` e `leadId`. Reconfirmar o fechamento atualiza o lançamento vinculado sem criar duplicidade. Se o lead sair de `Fechado`, essa receita automática é removida; lançamentos manuais não são afetados. Valores apenas propostos ou negociados continuam sendo informações comerciais e não entram no financeiro.

Categorias padrão e categorias criadas pelo usuário são persistidas. A normalização aceita estruturas financeiras anteriores com nomes em português, como `financeiro.movimentacoes`, sem apagar os registros existentes.

## Tipos de negócio

Os segmentos são armazenados no próprio estado v2 como objetos com `id`, `name` e `createdAt`. Cada lead utiliza `businessSegmentId`, permitindo renomear o segmento sem romper associações. Na primeira carga desta versão, leads existentes que ainda estejam sem classificação são migrados automaticamente para `Climatização`; classificações já definidas são preservadas.

O seletor no cabeçalho filtra lista, busca, pipeline, agenda, prospecção e métricas. A última seleção é persistida; se o segmento deixar de existir, o CRM volta para `Todos`.

## Metas comerciais

As metas de contatos, reuniões, propostas e vendas são configuradas em **Configurações → Metas**. Cada objetivo pode ser semanal ou mensal e fica salvo em `settings.goals` dentro do estado `crm_climatizacao_sp_v2`.

O dashboard calcula o progresso automaticamente a partir do histórico e da etapa dos leads no segmento selecionado. Ao virar a semana ou o mês, apenas o intervalo de cálculo muda; nenhum histórico é apagado.

## Relatórios por Segmento

A área **Relatórios por Segmento** compara todos os tipos de negócio cadastrados pelo usuário. Ela apresenta leads, contatos, reuniões, propostas, vendas e as conversões entre cada etapa, com ordenação por coluna, detalhamento do funil e gráficos de vendas, reuniões e conversão final.

Os períodos disponíveis são hoje, semana atual, mês atual, últimos 30 dias, ano atual, todo o período e intervalo personalizado. Os números usam `createdAt`, histórico de atividades e mudanças de etapa já existentes; registros antigos sem eventos completos utilizam `lastContact`, `updatedAt`, tentativas e etapa atual como compatibilidade, sem alterar nem apagar os dados originais.

## Importação

O fluxo de importação lê CSV, TXT, XLSX ou texto colado, detecta cabeçalhos comuns, permite mapear ou ignorar colunas, exige a escolha do tipo de negócio e apresenta uma prévia antes de salvar. Possíveis duplicados são verificados por telefone, WhatsApp, e-mail e combinação de nome/empresa. Por padrão são ignorados, mas podem ser importados quando o usuário escolher essa opção.

As importações sempre adicionam registros e não substituem a base existente.

## CSS

- `variables.css`: tokens de cor, tipografia, espaçamento, raios e sombras dos temas escuro e claro;
- `app.css`: estilos base, layout, componentes e documento A4 das propostas;
- `responsive.css`: media queries e adaptações para telas menores;
- `theme-light.css`: ajustes claros dos componentes, sem alterar o documento A4 das propostas.

## Aparência

Em **Configurações → Aparência**, o usuário pode escolher entre **Sistema**, **Claro** e **Escuro**. A preferência é aplicada antes da interface aparecer para evitar troca visível de cores e fica salva somente no navegador. A opção Sistema acompanha automaticamente o tema claro ou escuro do dispositivo.

## JavaScript

- `data.example.js`: base pública vazia usada como modelo; a cópia local `data.js` contém os leads desta instalação e não é versionada;
- `storage.js`: leitura, gravação e remoção segura no `localStorage`;
- `search.js`: normalização, indexação, busca por múltiplos termos, telefone, fuzzy search, ranking e debounce;
- `proposals.js`: modelo compatível, cálculos, normalização e composição do documento comercial;
- `app.js`: regras do CRM, propostas, catálogo, financeiro, metas e relatórios, renderização, eventos, importação/exportação e inicialização.

Os eventos continuam centralizados com `addEventListener` e delegação. O modelo anterior permanece compatível; os campos de segmentação e financeiro são normalizados durante a leitura.
