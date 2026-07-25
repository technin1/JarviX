# Deploy do JarviX — GitHub → Supabase → VPS

> **Segurança**: o `.env` deste projeto já vem preenchido com as chaves reais
> (Groq + Supabase) pra você não precisar copiar nada. Como essas chaves
> passaram por uma conversa de chat, **rotacione-as depois de validar que
> tudo funciona**: no Supabase em *Project Settings → API → Reset*, e no
> Groq no painel de API Keys. Gere novas e atualize o `.env` do VPS.
> Isso vale principalmente pra `service_role`, que ignora todas as regras
> de segurança (RLS) do banco.

## 1. Subir pro GitHub

`frontend/public/supabaseClient.js` já está com a **anon key** preenchida.
Ela é segura de deixar no código do frontend — é protegida pelas policies de
RLS, não por estar escondida.

Rode na sua máquina, dentro da pasta `JarviX/`:

```bash
git init
git add .
git commit -m "Projeto inicial do JarviX"
git branch -M main
git remote add origin https://github.com/techn1n/jarvix.git
git push -u origin main
```

O `.gitignore` já está configurado pra não subir `.env`, `node_modules` e os
adaptadores de modelo (pesados demais pro git). **Confira antes de dar push**
que não existe nenhum `.env` de verdade na pasta, só o `.env.example`.

## 2. Conectar ao Supabase

Você tem duas opções — recomendo a primeira:

### Opção A — via Supabase CLI (recomendado, versiona o schema)

```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU-PROJECT-REF   # pegue em Project Settings > General
supabase db push                               # aplica supabase/migrations/*.sql
```

Isso aplica o `supabase/migrations/20260712000000_initial_schema.sql` direto
no seu banco remoto. Toda mudança futura no schema, você cria como uma nova
migration (`supabase migration new nome_da_mudanca`) e roda `db push` de novo.

### Opção B — manual (mais simples, mas não fica versionado)

Copie o conteúdo de `supabase/migrations/20260712000000_initial_schema.sql`
e cole direto no **SQL Editor** do dashboard do Supabase.

Depois, em qualquer uma das opções, crie os buckets de Storage:
- `uploads` (arquivos enviados pelos usuários)
- `generated-projects` (zips gerados pelo worker de geração de projetos)
- `member-documents` — **mantenha "Public bucket" DESLIGADO**. Guarda fotos
  de CNH (dado sensível/LGPD); o backend gera links assinados temporários
  (5 min) só pra admins, nunca expõe URL pública.
- `scripting-projects` — **mantenha "Public bucket" DESLIGADO**. Guarda os
  `.zip` enviados no módulo Scripting Teacher (Projects); acesso restrito
  ao próprio dono via prefixo `${user_id}/...` no caminho do objeto,
  igual ao bucket `uploads`.

E torne seu usuário admin (necessário pra acessar `/admin.html`, o painel
de moderação de fine-tuning). Depois de criar sua conta pelo app, rode no
SQL Editor do Supabase:

```sql
update public.profiles set is_admin = true where id = 'SEU-USER-ID';
-- SEU-USER-ID está em Authentication > Users no dashboard do Supabase
```

## 3. Deploy no VPS

Seu VPS: `129.121.33.93`

Primeiro, teste que você consegue entrar por SSH:

```bash
ssh root@129.121.33.93
# ou o usuário que você configurou, ex: ssh deploy@129.121.33.93
```

Se pedir senha e você não sabe qual é, ou se a conexão for recusada, confira
com o provedor do VPS (DigitalOcean, Contabo, Hetzner, etc.) — geralmente a
senha inicial vem por e-mail ou já é uma chave SSH cadastrada na criação.

Depois de conectado, rode uma única vez:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
git clone https://github.com/SEU-USUARIO/jarvix.git /var/www/jarvix
cd /var/www/jarvix
cp .env.example .env
nano .env   # preencha com as chaves reais (Supabase, Groq, etc.)
docker compose up -d --build
```

Depois de subir, teste no navegador: `http://129.121.33.93`

**Firewall**: garanta que a porta 80 está liberada. Se o VPS usa `ufw`:

```bash
sudo ufw allow 80/tcp
sudo ufw allow OpenSSH
sudo ufw enable
```

**Importante sobre segurança**: só a porta 80 (Nginx) fica exposta pra
internet. O ai-core (porta 8000) e o backend (porta 3000) só conversam entre
si pela rede interna do Docker — ninguém de fora consegue bater neles
diretamente. Isso já está configurado no `docker-compose.yml`.

Quando tiver um domínio próprio, troque o `server_name` em
`nginx/nginx.conf` pelo domínio e configure HTTPS com Let's Encrypt
(`certbot --nginx`) — acessar por IP puro em HTTP não é adequado pra produção
com usuários reais (dados trafegam sem criptografia).

## 4. Ativar HTTPS (assim que tiver um domínio)

O Let's Encrypt **não emite certificado pra IP puro** — precisa de um
domínio. Passo a passo assim que você registrar um:

1. **Aponte o domínio pro VPS**: no painel do seu registrador (Registro.br,
   GoDaddy, Namecheap, etc.), crie um registro DNS tipo **A** apontando
   `seudominio.com` (e `www.seudominio.com`, se quiser) para `129.121.33.93`.
   Propagação de DNS pode levar de minutos a algumas horas.

2. **Confirme que propagou**:
   ```bash
   dig seudominio.com +short
   # tem que devolver 129.121.33.93
   ```

3. **Com o projeto já rodando no VPS** (nginx em HTTP, passo 3 já feito),
   rode:
   ```bash
   ./init-letsencrypt.sh seudominio.com seu-email@exemplo.com
   ```
   Isso pede o certificado ao Let's Encrypt e salva em `certbot/conf/`.

4. **Ative a config HTTPS**:
   ```bash
   # edite nginx/nginx-ssl.conf.template, troque SEU-DOMINIO-AQUI.com pelo seu domínio
   mv nginx/nginx-ssl.conf.template nginx/nginx-ssl.conf
   ```
   No `docker-compose.yml`, troque o volume do serviço `nginx` de
   `./nginx/nginx.conf` para `./nginx/nginx-ssl.conf`, depois:
   ```bash
   docker compose up -d --build nginx
   ```

5. **Renovação automática** (certificado dura 90 dias) — adicione ao
   crontab do VPS (`crontab -e`):
   ```
   0 3 * * * cd /var/www/jarvix && docker compose run --rm certbot renew && docker compose exec nginx nginx -s reload
   ```

A partir daí, `https://seudominio.com` funciona, e o `app.js` do frontend
já usa caminhos relativos — não precisa mudar nada de código.

A partir daqui, o arquivo `.github/workflows/deploy.yml` já deixa isso
automático: todo push na branch `main` vai:
1. Aplicar migrations pendentes no Supabase
2. Entrar no VPS via SSH, dar `git pull` e resubir os containers

### Secrets que você precisa cadastrar no GitHub

Vá em **Settings → Secrets and variables → Actions** no seu repositório e
adicione:

| Secret | O que é |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Gerado em supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | Senha do banco (Project Settings → Database) |
| `SUPABASE_PROJECT_ID` | O project-ref do seu projeto Supabase |
| `VPS_HOST` | IP ou domínio do seu VPS |
| `VPS_USER` | Usuário SSH (ex: `root` ou `deploy`) |
| `VPS_SSH_KEY` | Chave privada SSH com acesso ao VPS |

**Nunca coloque essas informações direto no código** — é exatamente pra isso
que existem os Secrets do GitHub Actions.

## 5. Revisão de segurança aplicada

Nada disso muda como você usa o sistema, mas exige rebuild + uma variável
nova no `.env`. O que foi corrigido:

- **Mini-chat confiava no `userId` enviado pelo navegador** — agora o socket
  exige o token do Supabase Auth na conexão e ignora qualquer identidade que
  o cliente tente declarar.
- **`conversationId` não era verificado** — hoje o backend confirma que a
  conversa pertence ao usuário autenticado antes de gravar qualquer mensagem
  nela (ou cria uma nova, nunca escreve na de outra pessoa).
- **Vazamento entre usuários no status de geração de projeto** (IDOR) — hoje
  só o dono do job consegue consultar o resultado.
- **CORS estava liberado pra qualquer site (`*`)** — agora só aceita as
  origens listadas em `ALLOWED_ORIGINS` no `.env`.
- **Rate limit** adicionado no chat e no upload — sem isso, nada impedia
  alguém de gerar milhares de chamadas pra Groq na sua conta.
- **Headers de segurança HTTP** (helmet) adicionados.
- **Foto da CNH** agora só aceita arquivos de imagem de verdade.
- Removida uma rota de login/cadastro no backend que **não era usada** (o
  frontend já fala direto com o Supabase Auth, que tem proteção própria) —
  menos código exposto, mesma funcionalidade.

### Aplicar no VPS

```bash
git pull
```

No `.env` do VPS, adicione (troque pelo seu IP ou domínio):
```
ALLOWED_ORIGINS=http://129.121.33.93
```

Depois:
```bash
docker compose up -d --build backend worker
docker compose restart nginx
```

Teste: abra o site, faça login, e confirme que o chat (fullscreen e mini)
continuam respondendo normalmente. Se o navegador começar a bloquear
requisições com erro de CORS no console, confira se `ALLOWED_ORIGINS` bate
exatamente com a URL que você usa pra acessar o site (incluindo `http://`
vs `https://` e a porta, se houver).

## 6. Troca de provedor de IA: DeepSeek → Groq

O fallback de IA (usado quando o modelo próprio não responde com confiança
suficiente) agora usa a [Groq](https://console.groq.com) em vez da DeepSeek.

**1. Gere uma chave em** console.groq.com → API Keys.

**2. Rode a migration nova** (SQL Editor do Supabase ou `supabase db push`):
```
supabase/migrations/20260720000000_replace_deepseek_with_groq.sql
```
Sem isso, o banco rejeita mensagens salvas com `source = 'groq'` (o
`CHECK constraint` antigo só aceitava `'own_model'` ou `'deepseek'`).

**3. Atualize o `.env` do VPS**, trocando a chave antiga pela nova:
```bash
nano /var/www/jarvix/.env
```
```
GROQ_API_KEY=gsk_sua_chave_aqui
GROQ_MODEL=llama-3.3-70b-versatile
```
(Pode remover a linha `DEEPSEEK_API_KEY` — não é mais usada.)

**4. Rebuild do ai-core** (é onde o cliente Groq vive):
```bash
cd /var/www/jarvix
git pull
docker compose up -d --build ai-core
```

**Teste**: mande uma mensagem no chat que force o fallback (ex: com
`USE_LOCAL_MODEL=false`, toda mensagem passa pelo Groq). A resposta deve
vir com `"source": "groq"`.

## 7. Reformulação: Dashboard como tela inicial + preferências de IA

Esta atualização mudou a tela inicial do app (de Chat para Dashboard) e
adicionou um sistema de preferências que a IA usa como contexto. Passos:

**1. Rode a migration nova** (SQL Editor ou `supabase db push`):
```
supabase/migrations/20260721000000_add_profile_preferences.sql
```

**2. Rebuild de tudo** (mudou frontend, backend e a lógica de chat):
```bash
cd /var/www/jarvix
git pull
docker compose up -d --build
docker compose restart nginx
```

**3. Teste**: faça login, confirme que a tela inicial agora é o Dashboard
(não mais o Chat). Defina uma preferência (ex: tom "técnico", foco "Código")
e salve. Vá pro Chat e mande uma mensagem — a resposta deve refletir essas
preferências, mesmo sem você mencioná-las na conversa.

## Ordem recomendada pra fazer isso hoje

1. Push pro GitHub (passo 1)
2. Aplicar o schema no Supabase, manualmente primeiro pra validar que funciona
   (passo 2, opção B)
3. Subir o VPS manualmente uma vez (passo 3), confirmar que os containers sobem
4. Só depois configurar os Secrets e deixar o `deploy.yml` automatizar o resto
