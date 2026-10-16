# MICA Hub

CRM online para prospecção, leads, pipeline, agenda, propostas, catálogo, financeiro, metas e relatórios.

Produção: [micahub.vercel.app](https://micahub.vercel.app)

## Arquitetura

A interface usa HTML, CSS e JavaScript. O build empacota a biblioteca oficial do Supabase, sem React.

- `index.html`: estrutura da interface e navegação.
- `assets/css/`: temas, componentes e layout responsivo.
- `assets/js/app.js`: módulos e regras de negócio.
- `assets/js/search.js`: índice de pesquisa.
- `assets/js/proposals.js`: catálogo, cálculos e documentos comerciais.
- `assets/js/sidebar.js`: navegação e acessibilidade.
- `assets/js/dashboard-data.js`: métricas derivadas e recortes comerciais, sem gravações.
- `assets/js/dashboard-ui.js` e `assets/css/dashboard.css`: Dashboard responsivo.
- `src/charts.js`: gráficos Chart.js empacotados no build, sem CDN.
- `src/cloud.js`: autenticação e sincronização privada.
- `scripts/build.mjs`: gera a pasta publicável `dist/`.
- `scripts/server.mjs`: servidor de desenvolvimento, restrito a `127.0.0.1`.
- `supabase/migrations/`: histórico das migrações já aplicadas.
- `tests/`: verificações automatizadas com dados fictícios.
- `AUDITORIA-MIGRACAO-REACT.md`: auditoria histórica, preservada sem alterações.

## Dados e segurança

O aplicativo exige login pelo Google ou por e-mail e senha. Os dados de negócio são carregados da conta no Supabase e mantidos em memória durante a sessão. O navegador guarda apenas a sessão de autenticação e a preferência de tema.

A camada `MicaData.load()/save()` alimenta a interface e coloca alterações na fila de sincronização. As funções `load_crm` e `save_crm` exigem autenticação. Os documentos ficam em `private.crm_documents`, com isolamento por usuário, RLS e controle de revisão.

Aguarde **Salvo na nuvem** antes de fechar. Falhas de conexão preservam alterações em memória e permitem baixar uma cópia. Encerrar o navegador à força pode perder alterações ainda não sincronizadas.

- Limites no banco: 120 leituras e 60 gravações por minuto por usuário.
- Documento de até 10 MiB por conta.
- Segundo fator disponível em **Minha conta**.
- Apenas a chave pública publishable fica no frontend. Segredos permanecem no Supabase.
- Cabeçalhos de segurança e política de conteúdo estão em `vercel.json`.

A confirmação de e-mail permanece temporariamente desativada. Sem domínio e SMTP configurados, a recuperação por e-mail não dispara envios. Google não depende do SMTP. CAPTCHA, proteção contra senhas vazadas e monitoramento externo não estão configurados neste repositório.

As migrações existentes não devem ser apagadas ou reaplicadas. `supabase/config.toml` descreve o ambiente de desenvolvimento e não altera, sozinho, a configuração hospedada.

## Backup e importação

O botão **Leads**, no topo, reúne cadastro individual, importação, exportação CSV e extração de contatos com filtros. O botão **Backup do Hub**, na sidebar, concentra o backup JSON completo e a restauração, separados das ações de leads.

Continuam disponíveis no aplicativo:

- CSV completo dos leads, com contatos, segmento, score e dados comerciais.
- Exportação de contatos por segmento, faixa de score, site e ausência de prospecção.
- Backup JSON do documento completo da conta e restauração por upload.
- Importação de leads por CSV, XLSX e lista colada.
- Impressão/PDF das propostas.

A execução offline, a base embutida, a persistência local de dados comerciais e a exportação de aplicativo HTML foram removidas. Abrir `index.html` diretamente não substitui o aplicativo online. Backups HTML antigos, já baixados, não são apagados por este código.

A pasta `backups/` contém cópias privadas e é excluída do Git, do upload para a Vercel e do build. Não envie esses arquivos ao repositório.

A importação manual de JSON antigo continua disponível para compatibilidade; não há leitura automática das antigas chaves do navegador.

## Desenvolvimento e validação

Requisitos: Node.js 22 ou superior e Microsoft Edge para testes de navegador. Outro executável Chromium pode ser indicado por `MICA_TEST_BROWSER`.

```powershell
npm ci
npm run build
npm run dev
npm test
npm run test:sidebar
npm run test:security
npm run test:dashboard
```

O servidor de desenvolvimento usa o mesmo fluxo autenticado da versão online; não existe modo local sem conta. Google retorna ao endereço configurado no Supabase. Para outro ambiente, use um projeto Supabase separado e configure os retornos explicitamente.

Os testes de navegador usam um servidor temporário em loopback, uma conta simulada e contatos fictícios. Não dependem de leads privados, não usam credenciais reais e não alteram o Supabase. O adaptador simulado fica somente em `tests/helpers/browser.mjs` e nunca entra em `dist/`.

`supabase/tests/security.sql` é uma suíte separada, transacional e finalizada com `ROLLBACK`. Sua execução em um banco não faz parte de `npm run test:security`.

## Dashboard comercial

O Dashboard usa exclusivamente o documento da conta autenticada, já carregado pelo Supabase. Não cria tabelas, altera RLS, grava agregados ou usa dados de demonstração. Chart.js 4.5.1 é empacotado localmente; os gráficos têm tooltips, movimento reduzido e alternativas textuais acessíveis.

- O seletor **Tipo de negócio** no topo e os botões de período filtram todos os painéis. Um lead entra no recorte quando foi cadastrado ou teve atividade/fechamento/perda registrados no intervalo. O funil, os interessados, as negociações e o potencial mostram a **posição atual desses leads**, não uma fotografia histórica.
- Tendências comparam o intervalo imediatamente anterior de mesma duração. Base anterior zero e período completo não geram porcentagens de crescimento artificiais. Não há tendência histórica de potencial ou etapas sem snapshots reais.
- Sparklines mostram cadastros ou atividades por intervalo. As séries de atividade distinguem ligações, WhatsApps confirmados e conversas; eventos ligados à mesma operação não são contados duas vezes. Ao analisar um histórico longo, os dados são agrupados em até 30 intervalos de calendário.
- Metas mantêm os alvos e ciclos semanais/mensais configurados. Contam leads distintos com a atividade correspondente, na interseção do ciclo da meta com o período selecionado e no segmento escolhido. Vendas usam a data efetiva do fechamento, inclusive fechamentos históricos preservados após reabertura; registros sem data não entram na meta.
- Receita fechada soma valores comerciais nas datas efetivas dos fechamentos, sem duplicar eventos ou reconfirmações do mesmo negócio. Um lead representa um negócio, como na regra existente do financeiro: o último fechamento válido define o valor/data; após reabertura, o fechamento preservado continua disponível sem multiplicar a receita. Não representa caixa recebido. Ticket médio divide essa receita pelos negócios com venda. A taxa de fechamento usa leads com venda sobre os leads do recorte.
- Potencial é **estimativa** de oportunidades abertas, reutilizando a regra existente de valores negociados/propostas/catálogo. Não é receita contratada nem saldo financeiro.
- Origem vem do cadastro do lead; ausência de informação é explícita. Ranking compara volume e leads convertidos por segmento. Motivos vêm dos registros de perda.
- Dados sem data confiável não são atribuídos arbitrariamente a dias. Fechamentos sem data ficam somente em **Todos**, com aviso de histórico incompleto. Etapas e valores potenciais passados não são reconstruídos a partir do estado atual.

`npm run test:dashboard` valida o modelo e a interface com dados sintéticos, sem contas ou gravações reais. Inclui filtros, períodos comparáveis, fechamento retroativo, reabertura, ausência de histórico, erros de desenho, temas e larguras de 320 a 1920 px. Execute `npm run build` antes dos testes de navegador para gerar o bundle dos gráficos.

## Publicação

A Vercel executa `npm run build` e publica somente `dist/`. O build usa uma lista explícita de arquivos permitidos. Testes, auditoria, backups, fontes privadas e credenciais não são publicados.

O documento por usuário mantém compatibilidade com os dados atuais, mas não é uma arquitetura de edição colaborativa. A futura migração React deve seguir uma nova autorização e consultar a auditoria preservada.
