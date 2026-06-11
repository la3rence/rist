#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper must run on macOS because it prepares a macOS code-signing certificate." >&2
  exit 1
fi

cert_name="${MAC_CODESIGN_CERT_NAME:-Rist Local Code Signing}"
cert_days="${MAC_CODESIGN_CERT_DAYS:-3650}"
out_dir="${MAC_CODESIGN_OUTPUT_DIR:-release/codesign}"
p12_path="${MAC_CODESIGN_P12_PATH:-$out_dir/rist-local-codesign.p12}"

if [[ -n "${MAC_CODESIGN_CERT_PASSWORD:-}" ]]; then
  p12_password="$MAC_CODESIGN_CERT_PASSWORD"
else
  printf "Password for exported .p12: " >&2
  stty -echo
  read -r p12_password
  stty echo
  printf "\n" >&2
fi

if [[ -z "$p12_password" ]]; then
  echo "A non-empty .p12 password is required." >&2
  exit 1
fi

mkdir -p "$out_dir"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/openssl.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[ dn ]
CN = $cert_name

[ v3_req ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
EOF

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -days "$cert_days" \
  -keyout "$tmp_dir/key.pem" \
  -out "$tmp_dir/cert.pem" \
  -config "$tmp_dir/openssl.cnf" >/dev/null 2>&1

openssl pkcs12 \
  -export \
  -inkey "$tmp_dir/key.pem" \
  -in "$tmp_dir/cert.pem" \
  -name "$cert_name" \
  -out "$p12_path" \
  -keypbe PBE-SHA1-3DES \
  -certpbe PBE-SHA1-3DES \
  -macalg sha1 \
  -passout "pass:$p12_password" >/dev/null 2>&1

base64 < "$p12_path" | tr -d '\n' > "$p12_path.base64.txt"

case "$p12_path" in
  /*) p12_file_url="file://$p12_path" ;;
  *) p12_file_url="file://$PWD/$p12_path" ;;
esac

cat <<EOF
Created: $p12_path
Created: $p12_path.base64.txt

Use these GitHub Actions secrets:
  MAC_CODESIGN_CERT_BASE64   contents of $p12_path.base64.txt
  MAC_CODESIGN_CERT_PASSWORD the .p12 password you entered
  MAC_CODESIGN_CERT_NAME     $cert_name

For a local signed build:
  CSC_LINK="$p12_file_url" CSC_KEY_PASSWORD=<password> CSC_NAME="$cert_name" pnpm dist:mac
EOF
