#!/bin/bash
# Rode este script UMA VEZ no VPS, depois que:
#   1. Você já tiver um domínio
#   2. O registro DNS tipo A do domínio já estiver apontando pro 129.121.33.93
#      (confirme com: dig SEU-DOMINIO-AQUI.com +short — tem que devolver o IP do VPS)
#   3. O container do nginx (versão HTTP, nginx.conf) já estiver rodando,
#      pois o certbot precisa responder ao desafio através dele.
#
# Uso:
#   chmod +x init-letsencrypt.sh
#   ./init-letsencrypt.sh SEU-DOMINIO-AQUI.com seu-email@exemplo.com

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Uso: ./init-letsencrypt.sh SEU-DOMINIO-AQUI.com seu-email@exemplo.com"
  exit 1
fi

echo "Solicitando certificado para $DOMAIN..."

docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

echo ""
echo "Certificado emitido (ou já existente) em ./certbot/conf/live/$DOMAIN/"
echo ""
echo "Próximos passos:"
echo "1. Edite nginx/nginx-ssl.conf.template, troque SEU-DOMINIO-AQUI.com por $DOMAIN"
echo "2. Renomeie: mv nginx/nginx-ssl.conf.template nginx/nginx-ssl.conf"
echo "3. Atualize o volume do nginx no docker-compose.yml pra apontar pra nginx-ssl.conf"
echo "4. docker compose up -d --build nginx"
echo ""
echo "Renovação automática: o certificado dura 90 dias. Adicione ao crontab do VPS:"
echo "  0 3 * * * cd /var/www/jarvix && docker compose run --rm certbot renew && docker compose exec nginx nginx -s reload"
