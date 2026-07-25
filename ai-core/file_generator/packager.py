"""
Empacota o conteúdo gerado pela IA (código, documentos, etc.) em um .zip
pronto para download, conforme jarvix1.0.txt:
"vai gerar download de diretórios e projetos completos com toda engenharia
empacotada em um zip. assim o usuário só extrai e testa."
"""
import io
import zipfile
from pathlib import Path


def build_zip_from_files(files: dict[str, str]) -> bytes:
    """
    files: {"caminho/relativo/arquivo.py": "conteúdo do arquivo", ...}
    Retorna os bytes do zip pronto pra ser salvo ou enviado como download.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for relative_path, content in files.items():
            zf.writestr(relative_path, content)
    buffer.seek(0)
    return buffer.read()


def build_zip_from_directory(directory: str) -> bytes:
    """
    Zipa um diretório inteiro já existente em disco (ex: projeto gerado
    passo a passo pela IA usando ferramentas de arquivo).
    """
    buffer = io.BytesIO()
    base = Path(directory)
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in base.rglob("*"):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(base))
    buffer.seek(0)
    return buffer.read()
