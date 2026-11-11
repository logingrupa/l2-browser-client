class ConverterSourceDigests:
    def __init__(self, reference_client_access):
        self.reference_client_access = reference_client_access

    def digest_of(self, relative_path):
        return self.reference_client_access.require_equal_file_with_sha256(relative_path)[1]

    def require_unchanged(self, relative_path, recorded_sha256):
        if self.digest_of(relative_path) != recorded_sha256:
            raise ValueError(f'Source changed during conversion: {relative_path}')
