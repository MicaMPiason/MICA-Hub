# MICA Hub

CRM local para organizar prospecção comercial, pipeline, tarefas, agenda, histórico de contatos, propostas, catálogo de serviços e produtos, indicadores e controle financeiro. Leads podem ser separados por tipo de negócio e importados por CSV, TXT, XLSX ou lista colada. A aplicação usa somente HTML, CSS e JavaScript e não depende de backend ou etapa de build.

## Estrutura

```text
.
├── index.html
├── assets/
│   ├── css/
│   │   ├── variables.css
│   │   ├── app.css
│   │   └── responsive.css
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

Abra `index.html` diretamente em um navegador moderno. Não é necessário instalar dependências, iniciar servidor ou compilar arquivos.

Em uma instalação nova, copie `assets/js/data.example.js` para `assets/js/data.js`. O arquivo `data.js` é local e ignorado pelo Git para que uma base privada de leads nunca seja versionada. A imagem opcional `assets/mica-portrait.webp`, usada na capa das propostas, também permanece somente no computador local.

Para executar os testes de regressão em uma máquina Windows com Microsoft Edge e Node.js disponíveis:

```powershell
node tests\smoke-test.mjs
```

Node.js é utilizado apenas pela suíte de desenvolvimento; não é requisito para usar o CRM.

## Persistência

A camada em `assets/js/storage.js` centraliza o acesso ao `localStorage` sem alterar o formato salvo. As chaves existentes foram preservadas:

- `crm_climatizacao_sp_v1`: estado legado, mantido para migração e recuperação;
- `crm_climatizacao_sp_v2`: estado atual com leads, fichas, histórico, tarefas, negociações, segmentos, financeiro, propostas, catálogo, metas, última carteira selecionada, configurações e templates.
- `mica_proposta_modelo_v1`: configuração do antigo gerador isolado, lida somente como origem de migração para preservar os valores já cadastrados.

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

- `variables.css`: tokens de cor, tipografia, espaçamento, raios e sombras;
- `app.css`: estilos base, layout, componentes e documento A4 das propostas;
- `responsive.css`: media queries e adaptações para telas menores.

## JavaScript

- `data.example.js`: base pública vazia usada como modelo; a cópia local `data.js` contém os leads desta instalação e não é versionada;
- `storage.js`: leitura, gravação e remoção segura no `localStorage`;
- `search.js`: normalização, indexação, busca por múltiplos termos, telefone, fuzzy search, ranking e debounce;
- `proposals.js`: modelo compatível, cálculos, normalização e composição do documento comercial;
- `app.js`: regras do CRM, propostas, catálogo, financeiro, metas e relatórios, renderização, eventos, importação/exportação e inicialização.

Os eventos continuam centralizados com `addEventListener` e delegação. O modelo anterior permanece compatível; os campos de segmentação e financeiro são normalizados durante a leitura.
