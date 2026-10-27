import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import UUID

CHUNK_SIZE = 1024 * 1024
PDF_HEADER_WINDOW = 1024


class InvalidPdfError(ValueError):
    pass


class EmptyUploadError(ValueError):
    pass


@dataclass(frozen=True)
class StoredFile:
    storage_key: str
    file_size_bytes: int
    sha256: str


class FileStorage(Protocol):
    def store(
        self,
        source: BinaryIO,
        *,
        project_id: UUID,
        document_id: UUID,
    ) -> StoredFile: ...

    def delete(self, storage_key: str) -> None: ...

    def open(self, storage_key: str) -> BinaryIO: ...


def default_storage_root() -> Path:
    configured_root = os.environ.get("SHOP_REVIEWER_STORAGE_DIR")
    if configured_root:
        return Path(configured_root).expanduser()

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "ShopDrawingReviewer" / "uploads"

    data_home_value = os.environ.get("XDG_DATA_HOME")
    data_home = (
        Path(data_home_value).expanduser()
        if data_home_value
        else Path.home() / ".local" / "share"
    )
    return data_home / "shop-drawing-reviewer" / "uploads"


class LocalFileStorage:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or default_storage_root()).expanduser().resolve()

    def store(
        self,
        source: BinaryIO,
        *,
        project_id: UUID,
        document_id: UUID,
    ) -> StoredFile:
        storage_key = f"{project_id}/{document_id}.pdf"
        destination = self._resolve_key(storage_key)
        destination.parent.mkdir(parents=True, exist_ok=True)

        temp_path: Path | None = None
        digest = hashlib.sha256()
        file_size_bytes = 0
        header = bytearray()

        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=destination.parent,
                prefix=".upload-",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temp_path = Path(temporary_file.name)
                while chunk := source.read(CHUNK_SIZE):
                    if len(header) < PDF_HEADER_WINDOW:
                        remaining = PDF_HEADER_WINDOW - len(header)
                        header.extend(chunk[:remaining])
                    temporary_file.write(chunk)
                    digest.update(chunk)
                    file_size_bytes += len(chunk)

            if file_size_bytes == 0:
                raise EmptyUploadError("The uploaded PDF is empty.")
            if b"%PDF-" not in header:
                raise InvalidPdfError("The uploaded file does not have a PDF header.")
            os.link(temp_path, destination)
            temp_path.unlink()
            temp_path = None
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

        return StoredFile(
            storage_key=storage_key,
            file_size_bytes=file_size_bytes,
            sha256=digest.hexdigest(),
        )

    def delete(self, storage_key: str) -> None:
        path = self._resolve_key(storage_key)
        path.unlink(missing_ok=True)

    def open(self, storage_key: str) -> BinaryIO:
        return self._resolve_key(storage_key).open("rb")

    def _resolve_key(self, storage_key: str) -> Path:
        relative_path = Path(storage_key)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("Invalid storage key.")

        path = (self.root / relative_path).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Storage key resolves outside the storage directory.")
        return path
