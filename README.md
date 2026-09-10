# Sentinel

SaaS de monitoramento de infraestrutura (ICMP/ping no MVP), com arquitetura
preparada para novos tipos de monitoramento no futuro (HTTP, TCP, DNS, SNMP,
agentes).

MVP completo: multi-tenant com RBAC, CRUD de sites/ativos/checks, fotos em
MinIO, engine de ping assíncrona com máquina de estados, topologia visual
(React Flow + Dagre) com modo de edição, dashboard, histórico e problemas,
convites, auditoria, entitlements por plano, logging estruturado, suíte de
testes (137 backend + 10 frontend) e uma revisão de segurança já aplicada.
Cada etapa está documentada nas seções abaixo, na ordem em que foi
construída — a leitura mais útil do estado atual do projeto é a seção
"Revisão final de arquitetura (Prompt 27)", ao final deste documento.

## Estrutura

```text
.
├── frontend/src/
│   ├── pages/               12 telas (dashboard, ativos, sites, topologia,
│   │                        problemas, membros, auditoria, auth...)
│   ├── components/          AppLayout, StatusBadge, AssetForm, topology/, ui/
│   └── lib/                 api.ts, auth-context.tsx, dagre-layout.ts
├── backend/
│   ├── app/
│   │   ├── api/              13 routers FastAPI
│   │   ├── core/              config, segurança, storage, logging, rate limit
│   │   ├── models/            15 models SQLAlchemy
│   │   ├── schemas/          12 módulos de schemas Pydantic
│   │   ├── services/         15 módulos de regra de negócio
│   │   └── repositories/     13 módulos de acesso a dados
│   ├── monitor/               worker de monitoramento (asyncio + icmplib)
│   ├── tests/                 137 testes pytest
│   └── migrations/           Alembic
├── caddy/Caddyfile           reverse proxy
├── docker-compose.yml
├── .env.example
└── README.md
```

## Como subir

```bash
docker compose up --build
```

Não é necessário nenhum passo manual antes disso: o `docker-compose.yml` usa
valores padrão de desenvolvimento para todas as variáveis de ambiente. Para
customizar (outro ambiente, credenciais próprias etc.), copie `.env.example`
para `.env` e ajuste.

```bash
cp .env.example .env
```

Serviços expostos:

| Serviço | URL |
|---|---|
| Aplicação (via Caddy) | http://localhost |
| Backend direto | http://localhost:8000 |
| Backend health | http://localhost:8000/health e http://localhost:8000/api/health |
| Frontend direto (dev server) | http://localhost:5173 |
| Console MinIO | http://localhost:9001 |

O Postgres possui healthcheck e o backend só inicia depois que o banco está
saudável. O worker aguarda a mesma condição.

## Decisões arquiteturais

- **Um serviço por responsabilidade**: `frontend`, `backend` e `worker` são
  processos e Dockerfiles independentes, mesmo compartilhando o mesmo
  diretório-fonte (`backend/`) para `backend` e `worker`. Isso evita que o
  worker de monitoramento fique acoplado ao ciclo de vida do processo HTTP.
- **`worker` sem privilégios desnecessários**: roda como usuário não-root,
  com `cap_drop: ALL` e `cap_add: NET_RAW` — a única capability necessária
  para ICMP raw socket (via `icmplib`). A lógica de ping em si é implementada
  em etapa futura; por ora o worker só confirma conectividade com o banco.
- **Migrations Alembic assíncronas**: o `env.py` usa o mesmo engine
  assíncrono (`asyncpg`) usado pela aplicação, evitando manter duas
  configurações de conexão (uma síncrona só para migrations).
- **`docker compose up --build` sem setup manual**: todas as variáveis têm
  defaults de desenvolvimento embutidos no `docker-compose.yml`
  (`${VAR:-default}`). Nenhuma credencial fica hardcoded no código-fonte —
  os defaults existem apenas na camada de orquestração, documentados em
  `.env.example`, e devem ser substituídos fora do ambiente local.
- **MinIO com bucket privado criado automaticamente**: um container
  `minio-init` (baseado em `minio/mc`) roda uma vez, cria o bucket definido
  em `MINIO_BUCKET` e garante que a política seja `none` (sem acesso
  anônimo). O acesso a objetos será feito por URLs assinadas, implementado
  em etapa futura.
- **Caddy como origem única em desenvolvimento**: `/api/*` e `/health` vão
  para o backend, o restante vai para o dev server do Vite. Isso permite que
  o frontend use `fetch('/api/...')` relativo, sem depender de CORS quando
  acessado por `http://localhost`. CORS também está habilitado no backend
  para o caso de acesso direto ao frontend em `http://localhost:5173`.
- **Bind mounts em `backend` e `frontend`**: código-fonte é montado dentro
  dos containers para permitir hot-reload (`uvicorn --reload` e o dev server
  do Vite) sem rebuild a cada alteração. O volume anônimo
  `/app/node_modules` no frontend evita que o `node_modules` do host
  (potencialmente compilado para outra arquitetura) sobrescreva o do
  container.
- **Tailwind v4 + shadcn/ui já inicializados**: tema padrão do shadcn está em
  uso nesta etapa (fundação). A direção visual definitiva do produto
  (tipografia, densidade, uso de cor) é tratada em etapa dedicada de
  interface, não nesta.

## Modelo de dados

```text
organizations
  ├── organization_users  (org_id, user_id, role)        [PK composta]
  ├── organization_invites
  ├── sites
  │     └── assets                     (RESTRICT ao deletar site)
  │           ├── checks
  │           │     └── check_results
  │           ├── asset_photos
  │           └── topology_links (source_asset_id / target_asset_id)
  └── audit_logs

users
  └── organization_users  (um usuário pode pertencer a N organizations)
```

Todas as tabelas de negócio carregam `organization_id` diretamente — inclusive
`checks`, `check_results`, `asset_photos` e `topology_links`, que já são
alcançáveis por `asset_id`. É redundante em termos de normalização, mas é a
decisão central de isolamento multi-tenant: **toda query de leitura filtra
por `organization_id` sem precisar de um JOIN até `assets`/`sites` para provar
posse**. Isso elimina uma classe inteira de bugs onde um JOIN mal escrito
vaza dados entre organizações.

### Índices

Todo `organization_id`, `site_id`, `asset_id` e `check_id` (como FK) tem
índice — cobre tanto os filtros de isolamento multi-tenant quanto os joins
mais comuns. Adicionalmente:

- `checks.next_check_at` — usado pelo monitor worker para buscar checks
  vencidos (`WHERE next_check_at <= now()`).
- `assets.status` e `check_results.status` — usados pelas telas de
  "Problemas" e pelo dashboard.
- `check_results.checked_at` — usado pelo histórico por período.
- `users.email` e `organizations.slug` — unique, para lookup de login e
  resolução de tenant por slug.

### Isolamento multi-tenant

- `organization_id` é obrigatório (`NOT NULL`) em toda tabela de negócio.
- Nenhuma tabela filha aceita um pai de outra organização: a validação de
  que `site_id`/`asset_id`/`check_id` referenciados pertencem à mesma
  `organization_id` do registro é responsabilidade da camada de serviço
  (implementada nas etapas de API), já que FKs sozinhas não conseguem
  expressar "mesma organização nos dois lados". O schema garante a
  integridade referencial; o isolamento por tenant nas queries é reforçado
  pela dependency `current_organization` do backend (etapa de autenticação).
- `users.email` é único globalmente (um usuário só existe uma vez, mesmo
  participando de várias organizations via `organization_users`).
- `topology_links` tem `CheckConstraint` contra auto-link
  (`source_asset_id <> target_asset_id`) e `UniqueConstraint` contra
  duplicata exata do mesmo par ordenado.
- `assets` tem `CheckConstraint` exigindo `hostname` ou `ip_address`.
- `sites.id` referenciado por `assets.site_id` usa `ondelete="RESTRICT"`:
  o banco recusa a exclusão de um site com ativos, exatamente como pedido
  ("não apagar silenciosamente os ativos").
- Datas usam `TIMESTAMPTZ` (`DateTime(timezone=True)`) em todas as tabelas,
  o que o Postgres sempre armazena internamente em UTC.
- IDs são UUID (gerados tanto pelo Python quanto por `gen_random_uuid()` no
  banco), evitando IDs sequenciais previsíveis/enumeráveis entre tenants.

A migration inicial (`63a9b41ee2e6_modelo_multi_tenant_inicial.py`) foi
gerada por autogenerate e validada manualmente: build, `upgrade head`,
`downgrade base` e `upgrade head` novamente, incluindo limpeza explícita dos
tipos ENUM do Postgres no downgrade (que não são removidos automaticamente
ao dropar as tabelas).

## Autenticação e sessão

Rotas em `/api/auth`: `register`, `login`, `logout`, `refresh`, `me`,
`change-password`.

- **Senha**: hash com Argon2id (`argon2-cffi`), não uma solução caseira.
- **Access token**: JWT stateless (`pyjwt`), 15 min, enviado pelo frontend via
  `Authorization: Bearer`. Não é revogável antes de expirar — troca
  deliberada por simplicidade (sem hit no banco a cada requisição
  autenticada); a janela de exposição em caso de vazamento é curta.
- **Refresh token**: string opaca de alta entropia, armazenada como hash
  (nunca em texto puro, mesmo padrão de `organization_invites.token_hash`),
  em cookie `httpOnly` + `Secure` (fora de dev) + `SameSite=Lax`, com
  `path=/api/auth` — só é enviado pelo browser nas próprias rotas de auth.
  Cada uso rotaciona o token (o antigo é revogado, um novo é emitido) e
  `logout`/`change-password` revogam explicitamente no banco (tabela
  `refresh_tokens`), viabilizando logout de verdade e derrubar sessões após
  troca de senha.
- **`current_user` / `current_membership` / `current_organization`**
  (`app/core/dependencies.py`): `current_user` decodifica o JWT.
  `current_membership` lê o header `X-Organization-Id` enviado pelo
  frontend e **sempre revalida contra o banco** que o usuário autenticado
  pertence àquela organização (404 se não pertencer — não confirma nem a
  existência da org para quem não é membro). `current_organization` deriva
  de `current_membership`, sem segunda consulta. Nenhuma rota deve confiar
  em um `organization_id` vindo do cliente sem passar por essa dependency.
- **Estrutura para SSO futuro**: a lógica fica isolada em `AuthService`
  (`app/services/auth_service.py`); adicionar Google/Microsoft/SSO depois
  significa acrescentar um novo caminho de emissão de tokens ali, não
  reescrever autenticação.
- Testado manualmente ponta a ponta: registro cria organização + membership
  `owner`; refresh rotaciona (token antigo passa a falhar); logout revoga;
  email duplicado → 409; senha errada → 401; sem token → 401. Os mesmos
  cenários viraram testes automatizados (`tests/test_auth.py`).

## RBAC

`app/core/authorization.py` centraliza as regras de role — nenhum router
deve conter `if membership.role == ...` espalhado:

- `require_role(*roles)`: dependency factory para proteger uma rota inteira.
- `ensure_role(membership, *roles)`: mesma checagem, para usar dentro de um
  service quando a permissão depende de mais que a rota (ex.: um único
  endpoint de PATCH que se comporta diferente por campo).
- `can_manage_target_role(actor, target)`: regra fina que um conjunto
  estático de roles não expressa — admin gerencia usuários, mas nunca
  remove/rebaixa um owner.
- Grupos prontos: `ROLES_MANAGE_ORGANIZATION` (só owner),
  `ROLES_MANAGE_USERS` (owner+admin), `ROLES_WRITE_OPERATIONAL`
  (owner+admin+operator), `ROLES_READ_ONLY` (todas as roles).

Ainda não há rotas de negócio (assets/sites/usuários chegam em prompts
futuros) para testar essas regras via HTTP de ponta a ponta. Os testes
pedidos no CLAUDE.md para esta etapa foram implementados no nível que já é
possível hoje:

- **"organização A não acessa organização B"** — testado via HTTP de
  verdade (`tests/test_multitenancy.py`), usando um app-sonda mínimo que
  depende das dependencies reais de produção (`get_current_organization`),
  sem precisar de uma rota de negócio já existente.
- **"viewer não altera ativo" / "operator não gerencia usuário" / "admin
  não remove owner" / "owner tem acesso integral"** — testados no nível dos
  helpers (`tests/test_authorization.py`), que é o contrato que qualquer
  rota futura vai reusar literalmente. Quando as rotas de usuários (prompt
  de organizações/convites) e de ativos (prompt de CRUD) existirem, os
  mesmos cenários ganham uma cobertura de ponta a ponta adicional — não
  substituem estes testes, complementam.

## Testes

```bash
docker compose exec backend pip install -r requirements-dev.txt  # uma vez
docker compose exec backend pytest
```

Suíte roda contra um banco `sentinel_test` separado (criado/recriado a cada
sessão de teste via `DROP DATABASE` + `CREATE DATABASE` na base `postgres`),
nunca contra o banco de desenvolvimento. `pytest-asyncio` e um engine
assíncrono por teste evitam o erro clássico de conexão asyncpg atravessando
event loops de testes diferentes.

`requirements-dev.txt` fica fora da imagem Docker de produção (só
`requirements.txt` é instalado no build) para não carregar pytest/httpx em
produção.

## Organizações, usuários e convites

Rotas em `/api/organizations` (autenticadas + `X-Organization-Id`) e
`/api/invites` (públicas, dependem só do token do convite):

- `GET/PATCH /organizations/current` — visualizar/editar organização atual
  (nome só; `plan` é somente leitura, cobrança não existe ainda). PATCH
  exige `ROLES_MANAGE_ORGANIZATION` (só owner).
- `GET /organizations/members` — lista com `search` (nome/email) e `role`,
  leitura liberada para qualquer role (inclusive viewer).
- `PATCH/DELETE /organizations/members/{user_id}` — trocar role / remover
  membro. Exige `ROLES_MANAGE_USERS` (owner+admin) **e**
  `can_manage_target_role` (admin nunca mexe em owner) **e** um guard
  adicional: a organização nunca pode ficar sem nenhum owner (bloqueia
  remover ou rebaixar o último).
- `GET/POST /organizations/invites`, `DELETE /organizations/invites/{id}` —
  gerenciar convites pendentes. Criar convite para um email que já é
  membro → 409. Criar um segundo convite para o mesmo email pendente
  **substitui** o anterior (não empilha convites duplicados).
- `GET /invites/{token}` — preview público (nome da org, role, se o email já
  tem conta) para a tela de aceite mostrar contexto antes de pedir senha.
- `POST /invites/accept` — aceita o convite. Sempre exige senha: se o email
  ainda não tem conta, cria uma (senha nova + nome); se já tem, a senha
  confirma posse da conta (em vez de exigir login prévio). Loga o usuário
  automaticamente ao final (mesmo cookie de refresh do login/register).
- **Sem provedor de email**: `POST /organizations/invites` só devolve
  `invite_url` no corpo da resposta (e loga) quando `APP_ENV=development`.
  Fora de dev, o token nunca aparece na resposta — mas também não existe
  envio real ainda (ver débito técnico).

Frontend (`frontend/src/pages`): `LoginPage`, `RegisterPage`,
`AcceptInvitePage`, `OrganizationSettingsPage`, `MembersPage` (lista de
usuários + seção de convites). `lib/auth-context.tsx` mantém o access token
só em memória (nunca em `localStorage`) e restaura sessão no load via
`/auth/me`, que já aciona o refresh automático do `lib/api.ts` quando volta
401. Só o `organization_id` selecionado é persistido em `localStorage` (não
é segredo). `AppLayout` mostra seletor de organização quando o usuário
pertence a mais de uma.

Testado ponta a ponta via curl (registro → convite → preview → aceite →
login automático → promoção de role → remoção bloqueada por regra de último
owner) e via `tests/test_organizations.py` / `tests/test_invites.py`.

## Sites

CRUD completo em `/api/sites`. Leitura liberada para qualquer role
(`ROLES_READ_ONLY`); criar/editar/remover exige `ROLES_MANAGE_SITES`
(owner+admin — **não** operator, seguindo a divisão de responsabilidades do
PROMPT 04 à risca: operator gerencia ativos/checks/topologia, não sites).

- `GET /sites?search=` — busca por nome, cada site já vem com `asset_count`
  (contagem via `LEFT JOIN` + `GROUP BY`, não N+1).
- `DELETE /sites/{id}` — verifica contagem de ativos antes de deletar e
  retorna 409 com a contagem se houver algum; a constraint
  `ondelete=RESTRICT` do schema (Prompt 02) é o backstop caso essa checagem
  seja contornada por uma race condition.
- Frontend: `SitesPage` — listagem com busca, formulário único reaproveitado
  para criar/editar, exclusão com `window.confirm`, indicador de ativos por
  site. Operator/viewer veem a lista sem formulário nem ações.

Testado via `tests/test_sites.py` (isolamento entre organizações, RBAC,
bloqueio de exclusão com ativos vinculados) e curl manual contra o backend
vivo.

## Ativos

CRUD completo em `/api/assets`. Leitura liberada a qualquer role; escrita
exige `ROLES_WRITE_OPERATIONAL` (owner+admin+operator — diferente de sites,
aqui operator pode gerenciar, conforme PROMPT 04).

- Validação de `hostname` (regex RFC 1123) e `ip_address` (IPv4 **e**
  IPv6, via `ipaddress.ip_address`) em `app/core/validation.py`,
  reaproveitada pelos schemas de criação e edição.
- Exige hostname ou IP tanto na criação (schema, `model_validator`) quanto
  na edição (service, porque um PATCH parcial só sabe se o resultado final
  é inválido depois de mesclar com o que já existia no banco).
- `site_id` é validado contra a organização atual (404 se o site não
  existir ali) — fecha a lacuna "recurso X pertence ao pai Y" que ficou
  como débito no Prompt 05, agora para ativo→site.
- Listagem pagina de verdade (`limit`/`offset`, resposta com `total`) e
  filtra por `search` (nome/hostname/IP), `site_id`, `status` e `enabled`
  — nunca retorna a tabela inteira de uma vez.
- Cada ativo já traz `checks_count`/`photos_count` (contagem via
  `LEFT JOIN` + `GROUP BY`, sem N+1) — as tabelas `checks` e `asset_photos`
  já existem desde o Prompt 02, mesmo sem UI própria ainda.
- Frontend: `AssetsPage` (busca, filtros, paginação, criar/editar/excluir/
  ativar-desativar, indicador de status por cor) e uma `AssetDetailPage`
  mínima — só o necessário para "visualizar detalhes"; o layout definitivo
  de detalhe do ativo é uma etapa própria mais à frente.

**Bug real pego pelos testes, não só teoria**: o primeiro rascunho de
`update_asset` fazia `setattr` nos campos e só validava "hostname ou IP"
depois — uma falha de validação levantava a exceção com o objeto ORM já
mutado e sujo na sessão, e a mutação pendente vazava para a *próxima*
requisição dentro do mesmo teste (falhando um autoflush em um endpoint
completamente não relacionado). Corrigido validando o estado final
mesclado *antes* de tocar no objeto rastreado pela sessão — nunca deixar um
objeto em estado inválido pendente, mesmo que a exceção pareça "local" à
função que a levantou.

## Storage MinIO e fotos dos ativos

`StorageService` (`app/core/storage.py`) é a única coisa no projeto que
importa `boto3`. Serviços/routers só conhecem `upload`, `delete`, `exists`,
`get_presigned_url` — trocar MinIO por S3/R2 depois significa reescrever só
essa classe.

- **Dois endpoints, um propósito cada**: `minio_endpoint` (`minio:9000`,
  interno) para upload/delete/exists; `minio_public_endpoint`
  (`localhost:9000`, publicado desde o Prompt 01) só para *assinar* URLs.
  Motivo: SigV4 assina o `Host` da URL — se o host assinado for diferente
  do host que o navegador efetivamente usa pra buscar a imagem, o MinIO
  rejeita com `SignatureDoesNotMatch`. Testado de ponta a ponta via curl: a
  URL assinada devolvida pela API foi baixada de verdade e os bytes batem
  byte a byte com o arquivo original.
- **Validação real, não só extensão**: `app/core/image_processing.py`
  decodifica a imagem com Pillow e confere se o formato decodificado bate
  com o Content-Type declarado — um PNG renomeado para `.jpg` com
  `Content-Type: image/jpeg` é rejeitado (422), não confia no nome do
  arquivo nem no header sozinho. Limite de tamanho configurável
  (`MAX_UPLOAD_SIZE_BYTES`, 10 MB por padrão).
- **Nome interno sempre UUID**: a storage key nunca deriva do nome de
  arquivo enviado (`organizations/{org}/assets/{asset}/{uuid}.{ext}`);
  `filename` original só é guardado pra exibição.
- **Thumbnail gerada no upload** (Pillow, máx. 320px, JPEG), guardada como
  objeto separado (`..._thumb.jpg`) — coluna nova `thumbnail_storage_key`
  em `asset_photos` (migration própria, Prompt 02 não previa essa coluna).
- **"Foto principal" sem coluna nova**: reaproveita `position` — a foto
  com `position=0` é a principal. Reordenar (`PATCH` com `position`) já
  cobre "ordenação" e "foto principal" com um único mecanismo, sem
  `is_primary` redundante.
- **Isolamento multi-tenant**: toda busca de foto filtra por
  `organization_id` *e* `asset_id` antes de qualquer coisa — nenhuma rota
  gera uma URL assinada a partir de um `storage_key` vindo do cliente.
  Testado explicitamente em `tests/test_asset_photos.py`
  (`test_photo_isolation_between_organizations`): cliente B recebe 404 pra
  listar, editar ou remover foto do cliente A mesmo sabendo `asset_id` e
  `photo_id`.
- Bucket segue privado (política `none`, criada pelo `minio-init` desde o
  Prompt 01) — a única forma de ler um objeto é via URL assinada de
  validade curta (`PRESIGNED_URL_EXPIRE_SECONDS`, 300s por padrão).

## Engine de monitoramento (ping) e máquina de estados

Implementados juntos, deliberadamente: o Prompt 10 do CLAUDE.md pede que a
avaliação de estado fique separada do mecanismo de ping desde o início — a
única forma de garantir essa separação é desenhar as duas peças ao mesmo
tempo, não escrever a mecânica de ping isolada e só depois tentar encaixar
a política de estado por cima.

Como nenhum prompt anterior criava uma API de `checks` (isso é formalmente
o Prompt 19, bem mais à frente), o worker não teria o que processar. Criei
agora só o necessário — `POST/GET/PATCH/DELETE /api/assets/{id}/checks`,
mesmo padrão de RBAC/isolamento dos outros recursos — para o engine ser
testável de ponta a ponta de verdade. A tela de configuração amigável
(sem expor JSON) continua sendo trabalho do Prompt 19.

### Worker (`backend/monitor/`)

- `repository.claim_due_checks`: `SELECT ... FOR UPDATE SKIP LOCKED` +
  `next_check_at` já empurrado pra frente **antes** de qualquer ping ser
  executado, tudo numa transação só. É isso que permite `worker-01`,
  `worker-02`, `worker-03` rodarem em paralelo sem processar o mesmo check
  duas vezes — nenhum espera o outro (`SKIP LOCKED`), e a reserva vale
  durante toda a janela de execução (que pode ser lenta se o host estiver
  em timeout), não só durante a query.
- `executors/`: registry por `check.type` (`monitor/executors/__init__.py`)
  — o loop principal não conhece ICMP nem nenhum tipo específico. Hoje só
  `ping` existe (`executors/ping.py`, via `icmplib`), mas adicionar
  `http`/`tcp`/`dns`/`snmp` depois é só registrar um novo executor.
- Concorrência limitada por `asyncio.Semaphore` (`MAX_CONCURRENT_CHECKS`):
  um host lento ou offline consome uma vaga do semáforo, não trava o lote
  inteiro.
- Mensagens de erro sempre normalizadas ("Sem resposta ICMP", "Não foi
  possível resolver o hostname") — nunca a exceção Python bruta como
  mensagem pro usuário.
- Log por lote (`checks_processados`, `checks_sucesso`, `checks_falha`,
  `duracao_lote_ms`), não um log por pacote ICMP individual.

### Capability do container do worker — a parte que não é óbvia

`cap_add: NET_RAW` no `docker-compose.yml` (desde o Prompt 01) **não é
suficiente sozinho** para um processo não-root abrir um raw socket ICMP —
isso só coloca a capability no bounding set do *container*. Um processo
não-root só consegue *usar* uma capability do bounding set se ela também
estiver marcada como *file capability* no binário que ele executa. Faltava
isso: `Dockerfile.worker` agora roda `setcap cap_net_raw+ep` no binário do
Python durante o build, antes de trocar para o usuário `worker`. Sem essa
linha, todo ping falhava com `PermissionError: Operation not permitted` —
confirmado manualmente rodando um ping de verdade dentro do container
`worker` real (não do `backend`, que roda como root e mascararia o
problema) antes e depois da correção.

### Máquina de estados (`app/services/state_policy.py`)

Função pura (`evaluate_state`), sem nenhuma referência a ICMP — recebe só
`success`/`latency_ms` genéricos, então serve para qualquer tipo de check
futuro. Contadores `consecutive_successes`/`consecutive_failures` vivem no
`Check` (não no `Asset`): um ativo pode ter mais de um check no futuro,
cada um com seu próprio histórico.

```
unknown --(1º check, sucesso)--> up
up      --(1 falha)------------> warning
warning --(mais falhas, <3)----> warning
warning --(3ª falha seguida)---> down
down    --(1 sucesso)----------> down (não recupera ainda)
down    --(2º sucesso seguido)-> up
qualquer--(sucesso c/ latência
           acima do threshold)-> warning
```

`latency_warning_threshold_ms` é um campo opcional dentro do `config`
JSONB do check (não uma coluna nova) — existe no backend mas não tem
controle na UI ainda, porque o Prompt 19 lista explicitamente só
`enabled`/`interval_seconds`/`timeout_seconds`/`packets` como campos da
tela de configuração de monitoramento.

Testado com `tests/test_state_policy.py` (12 cenários unitários, incluindo
"não vira DOWN na primeira perda isolada" e "recupera de DOWN só depois de
2 sucessos") e `tests/test_monitor_worker.py` (integração real: ping de
verdade contra `127.0.0.1` e contra um IP não roteável dentro da rede
Docker, `claim_due_checks` reservando e não deixando reclamar duas vezes,
`run_batch()` ponta a ponta).

## Histórico e Problemas

- `GET /assets/{id}/history?from=&to=&limit=` — resultados mais recentes
  primeiro, `limit` capado em 500 no service independente do que o cliente
  pedir.
- `GET /problems` — ativos em `warning`/`down` da organização atual,
  ordenados DOWN mais antigo → DOWN mais recente → WARNING (`CASE WHEN
  status = 'down' THEN 0 ELSE 1 END, status_since ASC`).
- Nova coluna `assets.status_since`: o worker (`monitor/main.py`) só
  escreve nela quando o status *muda* de fato (comparação antes de
  sobrescrever `asset.status`) — é o que permite "há quanto tempo" sem
  varrer o histórico de check_results a cada request.
- Sem filtros em `/problems` ainda (site/status/busca) — o Prompt 11 do
  CLAUDE.md não pede isso, só o Prompt 20 (tela dedicada de Problemas)
  pede explicitamente. `ProblemsPage` e a seção de histórico em
  `AssetDetailPage` são versões mínimas pelo mesmo motivo que
  `AssetDetailPage` já é mínima — o layout/filtros definitivos chegam
  quando os prompts que os pedem forem implementados.

## Topologia (backend)

Só backend — o Prompt 12 do CLAUDE.md é explicitamente "TOPOLOGY BACKEND";
a visualização com React Flow/Dagre é o Prompt 15, depois da direção
visual (Prompt 13) existir.

- `GET /topology?site_id=` — retorna `{nodes, edges}` prontos pro formato
  que o React Flow espera (o mapeamento final de nomes de campo acontece
  no frontend quando a tela for construída). Cada node só carrega o que a
  visualização precisa: `id, name, status, ip, last_rtt_ms, site,
  has_photo` — nada de payload pesado por nó numa topologia grande.
- `POST /topology/links` — valida, nesta ordem: site pertence à org atual;
  origem e destino existem e pertencem à org atual (senão 404 — não
  revela se o ativo existe em outra org); origem e destino pertencem ao
  **mesmo site** informado no link (422); não é auto-link (422, validado
  no schema); não é duplicata **em nenhuma direção** — A→B e B→A contam
  como a mesma conexão (409). A constraint `ck_topology_links_no_self_link`
  e o `UniqueConstraint` do schema (Prompt 02) seguem como backstop no
  banco para o caso exato (mesma direção), mas a checagem de duplicata
  bidirecional só existe na camada de serviço, porque o schema não tem
  como expressar "A,B é igual a B,A" com uma constraint simples.
- `topology_links.site_id` é único por link (não `source_site_id` +
  `target_site_id`) — por isso um link só conecta dois ativos do mesmo
  site. Conexões entre sites diferentes (ex.: link WAN matriz↔filial)
  ficam fora do escopo atual; o schema atual não comporta isso sem um
  redesenho.

## Direção visual (Prompt 13)

Sistema de design aplicado globalmente via tokens CSS (`src/index.css`),
não estilos soltos por página — mudar a paleta depois significa editar um
arquivo, não caçar classes.

- **Paleta**: fundo neutro frio levemente quente (`#F7F7F5`, não o
  cinza puro `oklch(x 0 0)` que o template shadcn gera por padrão, nem o
  bege+serif nem o preto+neon que são os dois padrões genéricos mais
  comuns). Um único accent técnico (`#2C5F7C`, azul-aço — remete a
  sinal/conectividade, não é o roxo/violeta genérico de SaaS). Cores de
  status (`--status-up/warning/down/unknown`) são um sistema à parte do
  accent de interação, com variante dark mode própria.
- **Tipografia**: Geist Variable (já estava instalada desde o Prompt 01
  via shadcn init — não é Inter/Roboto, tem caráter geométrico/técnico) +
  Geist Mono Variable, adicionada agora especificamente para dados
  operacionais (IP, RTT, packet loss, hostname) — mesma família tipográfica,
  tratamentos distintos para título/prosa vs. dado, exatamente como o
  Prompt 13 pede. Como `--font-mono` é um token global, todo `font-mono`
  que eu já tinha usado em páginas anteriores (Ativos, Problemas, Sites)
  herdou a fonte nova automaticamente, sem editar essas páginas.
- **Status nunca só por cor**: `StatusBadge`/`StatusShape`
  (`src/components/StatusBadge.tsx`) usam forma distinta por status —
  círculo cheio (up), triângulo (warning), quadrado (down), anel
  tracejado vazio (unknown) — além da cor. Requisito de acessibilidade
  explícito do CLAUDE.md, não decoração.
- **Layout**: sidebar fixa à esquerda (`AppLayout.tsx`), bordas finas em
  vez de sombra/cartão, item ativo marcado por uma barra de 2px na
  lateral (não um pill preenchido — evita a estética SaaS genérica).
  Responsiva: sidebar vira off-canvas abaixo do breakpoint `md`, com
  overlay pra fechar ao tocar fora.
- Nenhum item de navegação para páginas que ainda não existem (Topologia
  visual é Prompt 15) — a sidebar só lista o que já é clicável de verdade.
- Raio de borda deixado como já estava (`--radius: 0.625rem` = 10px, com
  a escala sm/md/lg/xl derivada por `calc()`) — já cai dentro da faixa que
  o Prompt 13 pede (6/8/10px), então não havia nada errado pra corrigir
  ali.
- Sem screenshot real de navegador nesta etapa (mesma limitação das
  etapas anteriores) — validado via build TypeScript limpo, CSS
  compilado conferido token a token, grep para garantir que nenhuma cor
  Tailwind solta (`bg-emerald-500` etc.) nem termos de microcopy
  proibidos pelo CLAUDE.md sobreviveram no código.

## Dashboard ("Visão geral")

`GET /api/dashboard` agrega em uma única resposta (3 queries no banco, sem
N+1) o que a spec pede: totais por status, saúde por site (`up_percentage`,
`null` — não `0%` — quando o site não tem ativos ainda), os 5 problemas
mais urgentes (mesma ordenação de `/problems`) e as 10 checagens mais
recentes da organização como "atividade recente" (não existe audit log
ainda — Prompt 22 —, então atividade recente = checagens, que é o dado
real disponível e resolve a mesma pergunta: "o que aconteceu por aqui").

Composição deliberadamente assimétrica (não uma grade de cards iguais):
"Estado geral" ocupa a largura toda com o número grande; "Problemas atuais"
(3/5 da largura) e "Sites" (2/5) ficam lado a lado, tamanhos diferentes
porque o conteúdo é diferente; "Atividade recente" fica embaixo, mais
discreta (`text-muted-foreground` no título, sem borda de destaque) —
informação secundária tem peso visual secundário.

## Topologia visual (Prompt 15)

Só o modo de visualização — o modo de edição (conectar/desconectar ativos
pela UI) é o Prompt 16, propositalmente separado ("Aplicar RBAC: owner,
admin, operator podem editar; viewer não" é mais fácil de acertar quando
editar e visualizar são caminhos de código diferentes desde o início, não
uma tela só com um `if` a mais).

- `AssetNode` (`components/topology/AssetNode.tsx`): nó compacto (112px),
  reaproveita `StatusShape` — mesma forma-por-status do resto do app,
  então o critério de acessibilidade (não só cor) vale aqui também, sem
  reinventar nada.
- `lib/dagre-layout.ts`: converte o grafo em posições via Dagre;
  `rankdir` muda entre `TB`/`LR` no botão "Vertical/Horizontal" — recalcula
  o layout inteiro a cada troca (não tenta animar a transição, seria
  complexidade sem valor real aqui).
- Handles do nó (`AssetNode`) trocam de posição (topo/base vs.
  esquerda/direita) conforme a direção do layout, para as arestas saírem
  do lugar visualmente certo em ambas as orientações.
- Busca de ativo: `useReactFlow().setCenter()` centraliza e dá zoom no nó
  encontrado; o nó recebe uma borda de destaque (`highlighted` em
  `AssetNodeData`) reaproveitando a mesma cor de accent usada em toda a
  UI para estado ativo/selecionado — não uma cor nova só pra isso.
- `AssetInspector` (drawer lateral): busca o ativo (`GET /assets/{id}`) e
  a primeira foto (`GET /assets/{id}/photos`, posição 0 = principal,
  mesma convenção do Prompt 08) só quando um nó é clicado — não busca
  fotos de todos os nós de uma vez.
- `nodesDraggable={false}` deliberado: isso é visualização, arrastar nó
  não persiste nada ainda (isso é trabalho do Prompt 16, que vai precisar
  decidir onde guardar posição manual separada da relação lógica de
  link, como o CLAUDE.md pede explicitamente).
- Arestas discretas: cor de borda do tema (`var(--border)`), sem glow,
  sem animação contínua — só a troca de cor no nó via status já comunica
  o que precisa.

## Editor de topologia (Prompt 16)

Mesma tela do Prompt 15, com um modo de edição — sem rota nova nem
endpoint novo, a API de `/topology/links` (Prompt 12) já validava tudo que
esse modo precisava (origem/destino da mesma organização e site, sem
auto-link, sem duplicata em nenhuma direção).

- **Nunca troca de modo sem clique explícito**: `nodesDraggable`/
  `nodesConnectable`/`onConnect`/`onEdgeClick` só ficam ativos quando
  `editMode` é `true`. Fora do modo de edição, a tela é estritamente
  somente-leitura — não tem como alterar nada sem primeiro clicar em
  "Editar topologia" (requisito explícito: "não permitir alterações
  acidentais durante visualização normal").
- **RBAC**: o botão "Editar topologia" nem aparece pra viewer
  (`canEdit` checado no client, igual às outras telas) — e mesmo que
  aparecesse, o backend rejeitaria com 403 (`ROLES_WRITE_OPERATIONAL` em
  `POST/DELETE /topology/links`, testado desde o Prompt 12).
- **Indicação visual do modo ativo**: borda do canvas muda pra cor de
  accent + uma faixa fixa no topo explicando a interação, exatamente
  porque o requisito pede "exibir claramente que o modo edição está
  ativo" — não um indicador sutil fácil de não notar.
- **Conectar**: arrastar de um handle a outro (interação nativa do React
  Flow) dispara `onConnect` → `POST /topology/links` → invalida a query
  e recarrega o grafo. **Remover**: clicar numa aresta em modo de edição
  pede confirmação → `DELETE /topology/links/{id}`.
- **Sem "salvar" em lote, deliberado**: cada conexão criada/removida já
  persiste imediatamente (mesmo padrão de Sites/Ativos/Membros no resto
  do app) — não existe um estado de rascunho pendente esperando um botão
  "Salvar". Interpretação de "salvar alterações" como "a ação já fica
  salva ao ser feita", não como um fluxo de rascunho+commit, que exigiria
  um endpoint em lote que não existe e não foi pedido no Prompt 12.
- **Posição manual não é persistida**: arrastar um nó em modo de edição
  reorganiza a visualização na sessão atual (útil pra separar nós
  sobrepostos antes de conectar), mas não grava nada — recarregar a
  página volta pro layout automático do Dagre. Isso é uma leitura
  deliberada do "caso posições manuais sejam persistidas, crie uma
  solução separada dos links topológicos": o CLAUDE.md descreve essa
  regra como condicional ("caso... sejam"), e persistir posição exigiria
  uma tabela nova só pra coordenadas de UI — escopo que o Prompt 12 não
  criou e que o MVP não pediu explicitamente. Fica como próximo passo
  natural se um usuário real precisar de layout manual fixo.

## Detalhe do ativo e lista de ativos (Prompts 17–18)

- `AssetDetailPage` reescrita seguindo a estrutura exata do Prompt 17:
  divisores (`border-t`) entre seções, não um card por linha. Ações
  (Editar ativo, Adicionar foto, Editar monitoramento, Desativar,
  Excluir) num único lugar no topo — "Adicionar foto"/"Editar
  monitoramento" rolam até a seção correspondente em vez de abrir um
  formulário solto fora de contexto.
- `AssetForm` virou componente compartilhado (`components/AssetForm.tsx`)
  usado por `AssetsPage` (criar/editar na lista) e `AssetDetailPage`
  (editar no detalhe) — o formulário é idêntico nos dois lugares, extrair
  evitou duplicar ~130 linhas.
- Fotos: clique abre lightbox (overlay full-screen, fecha ao clicar fora)
  — "visualização ampliada" pedida no Prompt 17, sem precisar de uma
  lib nova pra isso.
- "Editar monitoramento" fica na própria página de detalhe (intervalo,
  timeout, ativo/inativo) — cobre o pedido do Prompt 17 sem esperar o
  Prompt 19; o campo `packets` e a extração completa do JSON pra
  formulário continuam sendo trabalho do Prompt 19.
- **Lista de ativos**: revisei contra o Prompt 18 e faltavam duas coisas
  explícitas da spec que eu tinha deixado de fora — ordenação de coluna e
  clique na linha inteira (só o nome era link). Adicionei as duas:
  - Backend: `GET /assets?sort=` aceita nome de coluna com `-` opcional
    pra descendente (`sort=-last_check_at`); nome inválido cai pro
    default (`name`) em vez de 500 — testado.
  - Frontend: cabeçalhos de Nome/Status/Site/RTT/Perda/Última checagem
    são clicáveis (alternam asc/desc, com indicador ↑/↓); clicar em
    qualquer parte da linha abre o ativo, com `stopPropagation()` nos
    botões de ação e no link do nome pra não disparar os dois handlers
    juntos.
  - Thumbnail da foto principal na lista **não** foi implementado — a
    spec diz "pode incluir", não "deve", e exigiria um campo novo no
    `AssetOut` só pra isso; deixado de fora por ora.

## Gerenciamento de checks (Prompt 19)

`packets` virou campo de primeira classe na API (`CheckCreateRequest`/
`CheckUpdateRequest`/`CheckOut`) em vez de exigir que o cliente monte o
JSON de `config` manualmente — o schema nunca mais expõe `config` cru na
borda da API. Internamente o service ainda mapeia pra
`config={"packets": N}` (o modelo de dados do Prompt 02 já fixou `config`
como o lugar genérico de configuração por tipo de check) e preserva outras
chaves eventuais nesse dict num update parcial — o `latency_warning_threshold_ms`
opcional do Prompt 10 continua existindo ali, só não tem campo próprio na
API porque nenhuma UI pede ele ainda.

- Validação de limites: `packets` entre 1 e 10 (`ge`/`le` no Pydantic,
  testado com valor abaixo e acima do limite).
- Frontend: `MonitoringSection` (dentro de `AssetDetailPage`) ganhou o
  campo Pacotes no formulário de edição e no resumo somente-leitura
  ("PING · 30s · timeout 1s · 3 pacotes · ativo") — mesmo padrão do
  exemplo do Prompt 19.
- Faltava um jeito de **criar** o primeiro monitoramento de um ativo — só
  havia edição de um check já existente. Adicionado botão "Criar
  monitoramento PING" quando o ativo ainda não tem nenhum.

## Tela de Problemas (Prompt 20)

O Prompt 11 já tinha o essencial (`GET /problems`, ordenação DOWN
antigo→DOWN recente→WARNING); faltavam os filtros e a coluna "problema"
que o Prompt 20 pede explicitamente.

- `site_id`/`status`/`search` agora filtram `/problems`, mesmo padrão de
  querystring das outras listagens. `status` fora de `warning`/`down`
  (ex.: `up`) é **ignorado**, não devolve ativo saudável numa tela que
  promete só mostrar problema — testado.
- Coluna "Problema": mensagem normalizada do `check_result` mais recente
  do ativo (`"Sem resposta ICMP"` etc.), via subquery correlacionada por
  `asset_id` — é literalmente "por que" o ativo está em warning/down, não
  só o status repetido, exatamente como o mockup do prompt mostra.
- RTT saiu da listagem: o campo list do Prompt 11 tinha RTT, mas o Prompt
  20 lista explicitamente outro conjunto de campos (status, ativo, site,
  IP, problema, duração, última checagem) — segui o mais recente/mais
  específico.

## Plano e entitlements (Prompt 21)

`app/services/entitlement_service.py` é o único lugar do código com
`if organization.plan == ...` (na verdade nem isso — é um dict de
`PlanLimits` por nome de plano, sem `if` nenhum). Nenhum outro service
sabe o que cada plano permite; todos só chamam `ensure_can_add_asset`/
`ensure_can_add_user`/`ensure_can_upload_storage`.

- Planos (`free`/`starter`/`pro`/`business`) e limites
  (`max_assets`/`max_users`/`max_storage_bytes`/`history_retention_days`)
  existem só como config Python (`PLAN_LIMITS`), não em tabela — números
  não são definitivos comercialmente, o objetivo era a arquitetura,
  exatamente como o prompt pede. `business` tem todos os limites `None`
  (ilimitado) — é o caso que prova que o resto do código não pode
  assumir que todo plano tem um teto numérico.
- Erro estruturado, não string: `EntitlementLimitReached` (subclasse de
  `HTTPException`, status **402 Payment Required** — o único código HTTP
  que já significa "isso é sobre plano/cobrança", em vez de reaproveitar
  403/409 que já significam outra coisa) devolve
  `{error, limit_type, limit, current, plan}`. O frontend
  (`lib/api.ts`) monta a mensagem a partir desses campos
  ("Limite de ativos do plano free atingido (10/10)") — sem isso, um
  `detail` que virou objeto em vez de string quebraria silenciosamente
  pra "[object Object]"; pego e corrigido antes de virar bug de verdade.
- Três pontos de verificação: criar ativo (`asset_service.create_asset`),
  criar convite **e** aceitar convite (`invite_service` — checa nos dois
  momentos: convite não deveria nem ser criado sem vaga, e a aceitação é
  o momento em que a vaga é ocupada de fato, então precisa checar de
  novo ali), upload de foto (soma de `size_bytes` de todas as fotos da
  organização, checada antes do upload pro MinIO).
- Testado com plano `free` temporariamente rebaixado via `monkeypatch`
  (criar 10 ativos = ok, o 11º = 402; convite bloqueado quando membros já
  no limite; upload bloqueado quando armazenamento no limite) — validado
  também manualmente contra o limite real de 10 ativos do plano free.

## Auditoria (Prompt 22)

`audit_service.record()` é chamado dentro da mesma transação de cada
mutação relevante, antes do `commit()` — se a operação falhar depois, o
log de auditoria falha junto, nunca sobra um evento órfão de algo que não
aconteceu de verdade. Cobre exatamente a lista do prompt:
`asset.created/updated/deleted`, `site.created/updated/deleted`,
`user.invited/role_changed/removed`,
`topology.link_created/link_removed`,
`asset.photo_uploaded/photo_deleted`, `check.created/updated/disabled`
(mais `check.deleted`, que a lista do prompt não citava mas seguia o
mesmo padrão dos outros recursos — teria sido estranho deixar de fora).

- `check.disabled` é emitido em vez de `check.updated` especificamente
  quando `enabled` vira `false` — mais específico que um update genérico
  quando é exatamente isso que a spec pede como evento nomeado.
- `metadata` só carrega identificadores/nomes/roles — nunca senha, token
  ou segredo (testado explicitamente: nenhum log gerado por um fluxo real
  de convite contém as strings "password"/"token"/"secret" em qualquer
  lugar do metadata).
- Toda mutação que grava auditoria precisa do `user_id` de quem agiu —
  a maioria dos services já tinha isso disponível via `membership`; onde
  não tinha, adicionei `actor_user_id` como parâmetro explícito (services
  de asset/site/check/topology) em vez de inferir de outro lugar.
- `GET /audit-logs` é só owner/admin (`ROLES_MANAGE_USERS`) — é trilha
  administrativa, não dado operacional. Frontend: `AuditLogsPage`, link
  na sidebar visível só pra quem o backend deixaria acessar de qualquer
  forma (a UI não esconde nada que o backend permitiria, só evita mostrar
  um link que sempre daria 403).

## Testes (Prompt 23)

A maior parte da suíte já foi construída incrementalmente ao longo dos
prompts anteriores (132 testes de backend); esta etapa revisou contra o
checklist explícito do Prompt 23 e fechou duas lacunas reais:

- **"Mockar ICMP" era literal na spec, e eu não tinha feito isso** — os
  testes do worker (`test_monitor_worker.py`) usam rede de verdade
  (`127.0.0.1` e um IP não roteável), o que prova a integração real mas
  não cobre exceção de resolução de nome nem de permissão de socket, que
  são difíceis/lentas de provocar de forma confiável só com rede. Criei
  `tests/test_ping_executor.py` com `unittest.mock.patch` em
  `icmplib.async_ping`, cobrindo sucesso, timeout/packet loss parcial,
  `NameLookupError`, `SocketPermissionError` e um `ICMPSocketError`
  genérico (confirmando que a mensagem da exceção nunca vaza pro usuário).
  As duas suítes se complementam — mock cobre os galhos, rede real prova
  que a árvore inteira funciona.
- **Frontend não tinha nenhum teste automatizado** — zero tooling de
  teste existia. Adicionei Vitest + Testing Library (`npm test`) e os 5
  fluxos essenciais que o Prompt 23 pede por nome: login (sucesso e erro),
  listar ativos (com empty state), criar ativo, abrir detalhes de um
  ativo, e um smoke test de Topologia (carrega site + grafo, e não
  quebra — React Flow precisa de um stub de `ResizeObserver` que jsdom
  não tem, adicionado em `src/test/setup.ts`). Todos mockam `apiFetch` e
  `useAuth` diretamente (`vi.mock`), não uma API HTTP simulada — mais
  simples de manter e testa exatamente o que o componente chama.
- `vite.config.ts` precisou trocar `defineConfig` de `'vite'` para
  `'vitest/config'` (mesmo config, tipos diferentes — sem isso `tsc -b`
  rejeitava a chave `test`), e os arquivos `*.test.tsx`/`src/test/**`
  foram excluídos do `tsconfig.app.json` — testes não devem entrar no
  type-check da build de produção.
- Não persegui 100% de cobertura em nenhum dos dois lados, seguindo a
  instrução explícita do prompt — o critério foi "o que pode gerar
  vazamento entre clientes, indisponibilidade, estado incorreto, perda de
  dados", que já era o critério usado desde o Prompt 04.

## Observabilidade (Prompt 24)

Logging estruturado em JSON para backend e worker, com formatter e setup
compartilhados (`backend/app/core/logging.py`):

- `JsonFormatter` emite uma linha JSON por evento: `timestamp` (UTC ISO),
  `level`, `service` (`backend` ou `worker`), `message`, e os campos de
  contexto `organization_id`/`user_id`/`asset_id`/`check_id` quando o
  chamador os passa via `extra={...}` — omitidos quando não fazem sentido
  para o evento, em vez de aparecerem como `null`.
- `configure_logging(service)` instala esse formatter no root logger e
  realinha os loggers do próprio uvicorn (`uvicorn`, `uvicorn.access`,
  `uvicorn.error`) para o mesmo formato, em vez de deixar duas saídas
  divergentes no mesmo stdout. Usa `setLogRecordFactory` para carimbar
  `service` em todo `LogRecord` automaticamente, sem precisar passar esse
  campo em cada chamada de log espalhada pelo código.
- Nunca logamos senha, token, cookie ou secret — nenhuma rota de auth loga
  o corpo da requisição, e os únicos campos estruturados aceitos são os
  quatro IDs de contexto acima.
- `backend/app/core/request_logging.py` adiciona um middleware HTTP
  (`log_requests`) que loga uma linha por request — método, path, status,
  duração em ms e `organization_id` do header quando presente (não é
  validado ali; a validação de verdade já acontece nas dependencies de
  auth de cada rota, isso é só correlação de log) — e um handler global de
  exceção não tratada que loga o stack trace internamente mas devolve ao
  cliente só `{"detail": "Erro interno. Tente novamente."}`, nunca a
  mensagem crua da exceção (evita vazar nome de tabela, driver ou caminho
  de arquivo).
- O worker (`backend/monitor/main.py`) trocou `logging.basicConfig` por
  `configure_logging("worker")`, e o log de exceção por check
  (`process_check`) agora carrega `extra={"check_id": ..., "asset_id":
  ...}`, permitindo filtrar logs por ativo/check específico num coletor
  real. O log de lote (`checks_processados`/`checks_sucesso`/
  `checks_falha`/`duracao_lote_ms`) já existia desde o Prompt 09 e
  continua sendo uma linha por lote, não uma por pacote ICMP — spec pedia
  exatamente isso.
- `/health` e `/api/health` já existiam desde o Prompt 01; nada novo aqui
  além de confirmar que passam pelo mesmo pipeline de log.
- Prometheus/Grafana não foram adicionados, como a spec pediu
  explicitamente para não fazer no MVP — mas o formato JSON já deixa os
  logs prontos para qualquer coletor (CloudWatch, Loki, etc.) sem
  reformatação.
- Validado com boot limpo (`docker compose down -v && up --build`) e
  inspeção direta de `docker compose logs backend`/`worker`: linhas saem
  como JSON parseável desde o primeiro log de startup.

## Revisão de segurança (Prompt 25)

Revisão completa contra os 17 pontos do checklist do Prompt 25, antes de
considerar o projeto um MVP. Nenhum problema **CRÍTICO** foi encontrado —
os testes de isolamento multi-tenant do Prompt 23 (organização A nunca
acessa ativo/site/foto/topologia/check/usuário da organização B) seguem
passando, nenhuma rota ficou sem autenticação/autorização, não há SQL
injection (ORM em 100% das queries, nenhuma interpolação de string em
`text()`/`filter()`) nem mass assignment (todo `PATCH` usa um schema
Pydantic com allow-list explícito de campos, nunca `**dict()` bruto sobre
o model), e o bucket do MinIO segue privado (`mc anonymous set none` no
`minio-init`) com storage keys gerados por `uuid4` — impossível de adivinhar
mesmo conhecendo `asset_id`/`organization_id`.

### ALTO

- **`SECRET_KEY` com valor real cravado como default no
  `docker-compose.yml`** (`SECRET_KEY: ${SECRET_KEY:-<valor fixo>}`) e o
  mesmo valor duplicado por engano no `.env.example`. Qualquer subida sem
  configurar a variável de ambiente — inclusive em produção, por descuido —
  assinava tokens JWT com um segredo que está no controle de versão,
  permitindo forjar token válido para qualquer usuário. **Corrigido**:
  troquei o default por um placeholder obviamente falso
  (`INSECURE-DEV-ONLY-CHANGE-ME`) e adicionei um `model_validator` em
  `app/core/config.py` que recusa subir (`ValueError` na inicialização)
  sempre que `APP_ENV != development` e `SECRET_KEY` ainda for um dos
  placeholders conhecidos — impossível esquecer de configurar em produção
  sem o processo falhar imediatamente. Também corrigi uma corrupção no
  `.env.example` onde parte do valor de `CORS_ORIGINS` tinha ficado colada
  na linha do `SECRET_KEY`.

### MÉDIO

- **Sem rate limit em `/api/auth/login`, `/api/auth/register`,
  `/api/invites/{token}` e `/api/invites/accept`** — tentativas ilimitadas
  de força bruta de senha, spam de contas e adivinhação de token de
  convite. **Corrigido**: `app/core/rate_limit.py` implementa um limiter
  em memória por IP do cliente (10 logins/min, 5 registros/min, 20
  operações de convite/min) — deliberadamente em memória e não com Redis
  (CLAUDE.md proíbe adicionar Redis sem necessidade concreta); a limitação
  conhecida é que múltiplas réplicas do backend contariam tentativas
  separadamente, documentado no próprio módulo.
- **Login vazava existência de email por tempo de resposta**: a verificação
  de senha (Argon2, lenta de propósito) só rodava quando o usuário existia,
  então "email não encontrado" respondia visivelmente mais rápido que
  "senha errada" — um atacante conseguiria enumerar contas cadastradas só
  medindo o tempo de resposta, mesmo com a mesma mensagem de erro para os
  dois casos. **Corrigido**: `verify_password` agora roda sempre, mesmo sem
  usuário (contra `DUMMY_PASSWORD_HASH`, um hash Argon2 de descarte
  pré-computado), normalizando o tempo das duas respostas.
- **Container do backend rodava como root sem necessidade** — ao contrário
  do worker (que precisa de `NET_RAW` pra ICMP e já rodava não-root com
  `setcap` desde o Prompt 09), o backend não abre socket nenhum que exija
  privilégio elevado. **Corrigido**: `backend/Dockerfile` ganhou um usuário
  dedicado (`useradd` + `USER backend`), no mesmo padrão do
  `Dockerfile.worker`. Isso quebrou dois testes de integração real do
  worker (`tests/test_monitor_worker.py`) que dependiam implicitamente de
  ICMP funcionar como root dentro do container `backend` — corrigido
  mockando `icmplib.async_ping` nesses dois testes (mesmo padrão de
  `tests/test_ping_executor.py`), o que também os tornou mais rápidos e
  não dependentes de rede.

### BAIXO

- O console web do MinIO (porta 9001) fica exposto ao host no
  `docker-compose.yml`. Aceitável para desenvolvimento local — é
  conveniência de dev, não faz parte do fluxo da aplicação (que só usa a
  API S3 na porta 9000) — mas não deve ser exposto da mesma forma em
  qualquer ambiente real. Não alterado agora: removê-lo prejudicaria a
  ergonomia de dev sem nenhum ganho de segurança neste contexto (compose
  local, não manifesto de produção); fica documentado como cuidado para
  quando houver deploy real.
- Expiração de URL assinada (300s) e tempos de vida de access/refresh
  token já eram adequados — nenhuma mudança necessária, só confirmação.

Suíte completa (137 testes, incluindo 5 novos em `tests/test_security.py`
cobrindo rate limit, mensagem de erro uniforme e o guard do `SECRET_KEY`)
passando após as correções, com boot limpo (`docker compose down -v && up
--build`) e verificação manual de que o backend agora roda como
`uid=1000(backend)` em vez de root.

## Polimento do MVP (Prompt 26)

Revisão de consistência sobre o frontend já construído, contra o checklist
do Prompt 26 — não uma etapa de features novas. A regra visual do Prompt
13 (sem grade perfeita, sem estética Dribbble, sem excesso de
arredondamento/glow/gradiente, sem jargão de marketing, status nunca só
por cor) já vinha sendo seguida desde a implementação original de cada
tela; nada disso precisou mudar aqui.

O achado mais concreto e repetido foi **erro de fetch sem feedback nenhum
(ou pior, com feedback errado)**: várias `useQuery` mostravam loading e,
quando terminavam, só tratavam os casos "carregando" e "veio vazio" — sem
um branch para "falhou". Na melhor hipótese isso significava uma tela em
branco sem explicação; em duas telas era pior, porque a ausência de dado
por erro de rede e a ausência real de dado renderizavam a mesma mensagem:

- `PhotosSection` e `MonitoringSection` (`AssetDetailPage.tsx`) mostravam
  "Nenhuma foto ainda" / "Nenhum monitoramento configurado ainda" tanto
  quando não havia mesmo nada cadastrado quanto quando a requisição
  simplesmente falhava — informação errada apresentada como fato.
  Corrigido: os dois agora checam `isError` antes de cair no empty state.
- `HistorySection` (mesmo arquivo), `SitesPage`, `MembersPage` (usuários e
  convites), `AssetsPage`, `TopologyPage` (lista de sites e o grafo em si)
  e `AssetInspector` (painel lateral da topologia) não tinham nenhum
  branch de erro — adicionado em todos, seguindo o padrão já usado em
  `ProblemsPage`/`DashboardPage`/`AuditLogsPage` (`isError` → mensagem
  curta em `text-destructive`, sem stack trace nem jargão de backend).
  `MembersPage` também não tinha loading state pra lista de convites —
  adicionado junto.
- **Formulário sem validação client-side que já existe no backend**:
  `AssetForm` mostrava a dica "Informe pelo menos um: hostname ou IP" mas
  nada impedia o envio com os dois vazios — o usuário só descobria depois
  de uma ida e volta ao servidor (erro 422 convertido em mensagem limpa,
  mas ainda assim uma viagem evitável). Adicionada a mesma checagem no
  cliente, antes de chamar `onSubmit`.

Verificado e já adequado, sem necessidade de mudança:

- **Ações destrutivas** (excluir ativo, excluir site, remover membro,
  remover foto, remover conexão de topologia) já pedem confirmação via
  `window.confirm` com o nome do recurso na mensagem, em todas as telas.
  Ações reversíveis (revogar convite, desativar/ativar ativo, trocar role)
  deliberadamente não pedem — a assimetria de confirmação segue a
  gravidade real da ação, não um padrão aplicado cegamente em tudo.
- **Indicador de status sem depender só de cor**: `StatusShape` usa forma
  distinta por status (círculo/triângulo/quadrado/anel tracejado) desde o
  Prompt 15, e toda tela que lista status (`AssetsPage`, `ProblemsPage`,
  `DashboardPage`, `AssetDetailPage`, os nodes da topologia) usa
  `StatusBadge`/`StatusShape` — nenhuma tela ficou renderizando status como
  texto colorido cru.
- **Mobile**: `AppLayout` já tinha drawer com overlay, `aria-label` nos
  botões de abrir/fechar menu, e o conteúdo principal com
  `overflow-x-auto` para tabelas largas não vazarem da viewport.
- **Navegação**: sidebar com os 7 itens do Prompt 13 mais "Auditoria"
  condicional a quem gerencia usuários (o backend também nega 403 pra
  quem tenta contornar isso direto pela API) — nenhuma rota órfã, todo
  link de "ver ativo"/"ver todos" leva a um destino que existe.
- **Nomenclatura**: rótulos de status, roles e ações conferidos entre
  `DashboardPage`, `AssetsPage`, `ProblemsPage`, `AssetDetailPage` e
  `MembersPage` — todos usam os mesmos dicionários centralizados
  (`STATUS_LABELS`, `ROLE_LABELS` em `lib/types.ts`), não strings soltas
  reescritas em cada arquivo.
- **Requisições redundantes**: cada `useQuery` usa uma `queryKey`
  específica da tela; a única sobreposição de dado entre telas é a lista
  de sites, buscada com sufixos diferentes por tela (`__all_for_filter`,
  `__topology`, `__problems`, `__asset_detail`) propositalmente — são
  filtros populados uma vez por tela, não uma requisição repetida dentro
  da mesma tela. Não é N+1 (nenhuma tela faz uma requisição por item de
  uma lista) nem refetch em loop.

Build de produção (`npm run build`, `tsc -b && vite build`) sem erros de
tipo e suíte de frontend (10 testes) passando após as mudanças.

## CI/CD e deploy (GitHub Actions)

Fluxo de branches: trabalho acontece em `staging`; quando está validado no
ambiente de staging, o merge de `staging` para `master` dispara produção.
Não existe deploy automático a partir de nenhum outro branch.

```text
push em staging  →  CI (pytest + vitest)  →  deploy em staging
        │
        │ (validado manualmente em staging.seudominio.com)
        ▼
merge staging → master  →  CI  →  deploy blue-green em produção
```

Workflows (`.github/workflows/`):

- **`ci.yml`** — roda em todo push/PR contra `staging` ou `master`. Sobe a
  mesma stack de dev (`docker-compose.yml`) e roda `pytest` dentro do
  container do backend (igual ao fluxo manual documentado em "Testes"), mais
  lint/build/testes do frontend. Também exposto como `workflow_call`, reusado
  pelos dois workflows de deploy como gate.
- **`deploy-staging.yml`** — em push para `staging`: roda `ci.yml` e, se
  passar, conecta via SSH e executa `deploy/staging-deploy.sh` no servidor.
  Staging é uma stack única e completa (`docker-compose.staging.yml`), com
  Postgres/MinIO/bucket/domínio próprios — nunca compartilha dado com
  produção, mesmo rodando na mesma VM.
- **`deploy-production.yml`** — em push para `master` (ou seja, no merge):
  roda `ci.yml` e, se passar, executa `deploy/prod-deploy.sh` via SSH.
- **`rollback-production.yml`** — só `workflow_dispatch` (botão manual em
  Actions). Roda `deploy/prod-rollback.sh`. Sem gatilho automático de
  propósito: rollback é sempre uma decisão humana.

### Produção: blue-green de verdade

Postgres e MinIO são **únicos e nunca duplicados** (`docker-compose.prod.shared.yml`).
Só a camada sem estado — backend, worker, frontend — existe em dois slots
(`docker-compose.prod.app.yml`, subido duas vezes como projects `sentinel-blue`
e `sentinel-green`, conectados à mesma rede externa `sentinel_net`).

`deploy/prod-deploy.sh`:

1. builda e sobe o slot **inativo** com o código novo (o entrypoint do
   backend já roda `alembic upgrade head` antes do healthcheck passar);
2. só segue se o slot novo ficar saudável — se falhar, o script para aqui e
   o slot antigo continua servindo tráfego sem interrupção;
3. reescreve `deploy/active-slot.env` (nunca commitado) e recria só o
   container do Caddy (`docker-compose.prod.shared.yml`), que lê o upstream
   ativo de `{$BACKEND_UPSTREAM}`/`{$FRONTEND_UPSTREAM}` no
   `caddy/Caddyfile.prod` — troca de tráfego em menos de 1s, sem rebuild;
4. para (sem remover) o slot antigo, pronto pra rollback instantâneo com
   `deploy/prod-rollback.sh` (religa sem rebuild e reaponta o Caddy de volta).

Como Postgres é único e compartilhado entre os dois slots, migrations
precisam continuar backward-compatible durante a janela de troca — a mesma
regra de qualquer blue-green com banco compartilhado, não algo que este
projeto resolve automaticamente.

### Setup único no servidor (manual, uma vez)

O VM de produção (177.72.80.11) já roda um Nginx Proxy Manager que termina
TLS em 80/443 e encaminha por domínio para portas internas — o Caddy deste
projeto nunca fala HTTPS diretamente. Antes do primeiro deploy automático:

```bash
docker network create sentinel_net

git clone <repo> /root/sentinel-tiiv            # branch master (produção)
git clone <repo> /root/sentinel-tiiv-staging    # branch staging

cd /root/sentinel-tiiv-staging && git checkout staging
cp .env.staging.example .env.staging   # preencher os valores

cd /root/sentinel-tiiv
cp .env.production.example .env.production   # preencher os valores
bash deploy/prod-deploy.sh   # primeiro deploy, roda o slot "blue"
```

Depois disso, cadastre em Settings → Secrets and variables → Actions do
repositório no GitHub:

```text
DEPLOY_SSH_HOST
DEPLOY_SSH_USER
DEPLOY_SSH_KEY    # chave privada; a pública precisa estar em
                  # authorized_keys do usuário de deploy no servidor
DEPLOY_SSH_PORT   # opcional, default 22
```

E aponte no NPM os domínios de staging/produção para `localhost:8400` e
`localhost:8300` respectivamente (mesmo modelo que já existe para produção).

## Débito técnico deixado intencionalmente

Lista consolidada e mantida atualizada — itens de etapas anteriores que
foram resolvidos por etapas posteriores (ex.: "StorageService não existe
ainda", "worker não faz ping ainda", "sem testes ainda") foram removidos
daqui em vez de deixados como ruído histórico. O que segue é débito real,
presente no estado final do projeto:

- A tela de Topologia nunca foi validada num navegador real (nenhuma
  ferramenta de automação de navegador esteve disponível durante todo o
  desenvolvimento) — interação de pan/zoom/drag do React Flow e cálculo de
  layout do Dagre foram validados só por build TypeScript limpo, pelos
  testes automatizados (que verificam que a tela carrega e não quebra, não
  que o layout visual está correto) e por revisão de código cuidadosa
  contra a documentação das duas bibliotecas. Se algo visual estiver
  errado (posicionamento, z-index do drawer, overflow do canvas), é o
  candidato mais provável do projeto inteiro.
- `next_check_at` desabilita completamente quando o check é desligado
  (`enabled=False`); reabilitar sempre dispara um check imediato, mesmo
  que o desligamento tenha durado 5 segundos. Aceitável pro volume
  esperado do MVP.
- O worker roda um `POLL_INTERVAL_SECONDS` fixo de 5s consultando o banco
  — funciona bem na escala do MVP, mas é polling, não uma fila de
  verdade. Escolha consciente (sem Redis/Celery/Kafka), não descuido.
- `MINIO_PUBLIC_ENDPOINT` (default `localhost:9000`) só funciona para dev
  local. Em qualquer deploy real precisa apontar para um domínio público
  de verdade servindo o MinIO (ou um CDN na frente dele) — variável já
  existe, só o valor de produção que falta.
- Testes de fotos usam o MinIO real (não mockado) e escrevem no mesmo
  bucket de desenvolvimento — os testes limpam o que criam, mas 2 testes
  de reordenação/isolamento deixam 3-4 imagens de poucos KB órfãs no
  bucket a cada execução da suíte. Inofensivo, mas um bucket dedicado a
  testes seria mais limpo.
- Recuperação de senha ("esqueci minha senha") não tem rota nem tabela —
  a separação services/repositories já comporta adicionar sem refatorar,
  mas nada foi criado prematuramente.
- Sem provedor de email real: convites só funcionam pelo link retornado
  no ambiente de desenvolvimento (log estruturado, gated por
  `APP_ENV=development`). Em qualquer outro ambiente, não há como o
  convidado receber o link hoje.
- Suíte de testes roda `Base.metadata.create_all` no banco de teste, não
  as migrations Alembic — mais rápido, mas não valida a migration em si
  (essa validação continua sendo o ciclo manual
  `upgrade`/`downgrade`/`upgrade` documentado na seção do modelo de
  dados).
- `frontend` roda o dev server do Vite dentro do container mesmo em
  "produção" local; uma imagem de build estático (Vite build + serve via
  Caddy) fica para quando o projeto avançar além do MVP local.
- Rate limiter (Prompt 25) é em memória por processo — com múltiplas
  réplicas do backend atrás de um load balancer, cada réplica contaria
  tentativas separadamente (ver `app/core/rate_limit.py`); um limiter
  compartilhado deixaria de ser opcional nesse cenário.
- Logs não vão para nenhum coletor externo (CloudWatch/Loki/etc.) — só
  stdout do container, capturado pelo `docker compose logs`. Formato JSON
  já deixa isso pronto para quando houver um coletor real.
- Console web do MinIO (porta 9001) exposto ao host — conveniência de dev,
  não deve ser exposto da mesma forma num deploy real (ver Prompt 25).
- Rate limiter em memória (ver item acima) some a cada deploy de produção:
  o slot novo do blue-green começa com contadores zerados, então tentativas
  de brute-force feitas pouco antes de um deploy não carregam pro slot
  seguinte. Efeito colateral aceitável do MVP, não uma vulnerabilidade nova.
- Staging roda na mesma VM de produção (`docker-compose.staging.yml`
  compartilha CPU/RAM/disco com os dois slots de produção, embora dado e
  rede sejam isolados) — um teste pesado em staging pode competir por
  recurso com produção. Aceitável na escala atual; separar staging pra um
  servidor próprio é o próximo passo natural se isso virar problema.

## Revisão final de arquitetura (Prompt 27)

### 1. Arquitetura atual

A hierarquia de domínio permanece exatamente a definida no início do
projeto, sem desvios:

```text
Organization
    ├── Users (via organization_users, com role)
    └── Sites
          └── Assets
               ├── Photos (metadados no Postgres, binário no MinIO)
               ├── Checks
               │    └── Results (check_results)
               └── Topology Links (grafo, não árvore)
```

E o fluxo de dados também permanece o desenhado no Prompt 00:

```text
React (Vite) → FastAPI → PostgreSQL
FastAPI → MinIO (upload/delete/presigned URL)
Worker (asyncio) → PostgreSQL (claim via FOR UPDATE SKIP LOCKED) → ICMP (icmplib)
```

Sete serviços no `docker-compose.yml`: `postgres`, `minio`, `minio-init`
(roda uma vez, cria o bucket privado, sai), `backend`, `worker`,
`frontend`, `caddy`. Nenhum serviço a mais foi introduzido em nenhuma das
27 etapas.

### 2. Principais módulos

- **`backend/app/core/`** — a camada que todo o resto depende: config
  centralizada (`config.py`, com o guard de `SECRET_KEY` do Prompt 25),
  autenticação (`security.py`), autorização centralizada
  (`authorization.py`, evita `if role == ...` espalhado), dependencies de
  request (`dependencies.py` — `get_current_user` →
  `get_current_membership` → `get_current_organization`, sempre
  revalidando o `X-Organization-Id` contra o banco), storage abstraído do
  SDK do MinIO (`storage.py`), logging estruturado (`logging.py`,
  `request_logging.py`) e rate limiting (`rate_limit.py`).
- **`backend/app/{api,services,repositories}/`** — separação estrita:
  routers só validam entrada/autorizam/chamam service; services carregam
  regra de negócio e nunca fazem query direta; repositories são a única
  camada que toca `AsyncSession`. Todo repository/service recebe
  `organization_id` explicitamente — não existe caminho de código onde um
  recurso é buscado sem esse filtro.
- **`backend/monitor/`** — processo separado, mesma base de código
  (importa `app.models`/`app.services` diretamente, sem duplicar nada).
  `repository.py` isola o `SELECT ... FOR UPDATE SKIP LOCKED` que permite
  múltiplos workers sem checar o mesmo ativo duas vezes; `executors/`
  isola o protocolo (só `ping.py` hoje — o ponto de extensão para
  HTTP/TCP/DNS/SNMP futuros).
- **`frontend/src/lib/api.ts`** — único ponto de contato HTTP do frontend;
  centraliza refresh silencioso de token e formatação de erro (incluindo
  o erro estruturado de entitlements do Prompt 21). Nenhuma página chama
  `fetch` diretamente.
- **`frontend/src/components/topology/`** + **`lib/dagre-layout.ts`** — a
  tela mais complexa do produto, isolada do resto do app; `dagre-layout.ts`
  é puro (recebe nodes/edges, devolve posições), sem estado React.

### 3. Principais decisões

- **Multi-tenancy por coluna, não por schema/banco separado.** Mais
  simples de operar (uma migration, um pool de conexão) e suficiente para
  o volume esperado do MVP; o preço é que cada query precisa lembrar do
  filtro — mitigado centralizando esse filtro nos repositories, nunca
  deixando a decisão para cada endpoint.
- **Polling em vez de fila.** O worker consulta o banco a cada 5s com
  `SKIP LOCKED` em vez de Redis/Celery/RabbitMQ — CLAUDE.md pediu
  explicitamente para evitar essas dependências sem necessidade concreta,
  e no volume de ICMP do MVP polling não é gargalo.
- **Rate limiting em memória em vez de um serviço dedicado** (Prompt 25)
  — mesma lógica: adicionar Redis só para isso contradiria a simplicidade
  priorizada, e o modelo atual (um processo por container) não precisa
  de estado compartilhado. Documentado como ponto que muda de opcional
  para necessário se o backend ganhar múltiplas réplicas.
- **StorageService como abstração, nunca o SDK do MinIO direto em
  código de negócio** — troca futura por S3/R2 é uma mudança de uma
  classe, não uma migração de todo o código que mexe com fotos.
- **Entitlements como camada central** (Prompt 21) em vez de
  `if organization.plan == "pro"` espalhado — mudar um limite de plano é
  editar um dicionário em `entitlement_service.py`, não caçar
  condicionais pelo código.

### 4. Pontos fortes

- Isolamento multi-tenant é, na prática e não só na intenção, impossível
  de contornar por engano: todo repository exige `organization_id`, toda
  dependency de auth revalida contra o banco, e a suíte de testes cobre
  esse isolamento explicitamente para cada recurso (sites, ativos, fotos,
  checks, topologia, usuários) desde o Prompt 23.
- 137 testes de backend + 10 de frontend cobrindo os fluxos que
  realmente importam (vazamento entre clientes, RBAC, máquina de estado,
  worker mockado e real) — sem perseguir 100% de cobertura, seguindo a
  instrução explícita do Prompt 23.
- Nenhuma dependência de infraestrutura além do que o `docker-compose.yml`
  já sobe — `docker compose up --build` continua sendo o único comando
  necessário para rodar o projeto inteiro, do Prompt 01 ao Prompt 26.
- A revisão de segurança do Prompt 25 encontrou e corrigiu 4 problemas
  reais (não hipotéticos) com testes cobrindo cada correção, em vez de
  ser um checklist só de leitura.

### 5. Débitos técnicos conhecidos

Ver a seção "Débito técnico deixado intencionalmente" logo acima — lista
consolidada, sem entradas obsoletas. Os itens de maior impacto prático
são: nenhuma validação em navegador real da tela de Topologia, ausência
de provedor de email real (convites só funcionam via link em dev), e o
rate limiter em memória não sobrevive a múltiplas réplicas do backend.

### 6. Três próximos recursos (não implementados agora)

1. **Novo tipo de check (HTTP).** A arquitetura já foi desenhada para
   isso: `checks.type` já é uma string livre, `config JSONB` já aceita
   forma arbitrária, e `monitor/executors/` já é um ponto de extensão
   (`get_executor(check.type)`). Adicionar HTTP é criar
   `executors/http.py` e estender o formulário do Prompt 19 — não exige
   mudar nenhum model ou tabela existente.
2. **Reconhecimento de incidentes (acknowledge) na tela de Problemas.** O
   Prompt 11 deixou isso deliberadamente fora do MVP, mas a tabela
   `check_results`/o estado do ativo já registram `status_since`; falta
   só uma tabela pequena de acknowledgment (quem, quando, nota opcional)
   e um botão na tela de Problemas.
3. **Cobrança real por trás do `EntitlementService`.** O Prompt 21
   construiu a camada de limites (`max_assets`, `max_users`,
   `max_storage_bytes`) sem nenhuma integração de pagamento. Plugar um
   provedor (Stripe ou equivalente) significa popular `organization.plan`
   a partir de um webhook, sem tocar em nenhum dos pontos que já
   verificam limite hoje.
