from data.pinned_elbera_module import ELBERA_COMMIT

NO_MATERIAL_PREFIX = 'none'
RESERVED_INT32_MATERIAL_PREFIX = 'reserved-int32'
SHADER_BLOCK_MATERIAL_PREFIX = 'reserved-int32-and-shader-block'
LINEAGE_MATERIAL_MINIMUM_PACKAGE_VERSION = 123
LINEAGE_RESERVED_INT32_LICENSEES = range(16, 37)
LINEAGE_SHADER_BLOCK_LICENSEES = range(30, 37)
ELBERA_SOURCE_NAME = 'Elbera'
ELBERA_L2LIB_README_PATH = 'tools/l2lib/README.md'
ELBERA_L2LIB_README_SHA256 = '32b12d39022a92f4fef951edbecf4094c0a01a8237531c92d81918da752f0a9c'
UEVIEWER_REPOSITORY = 'gildor2/UEViewer'
UEVIEWER_REVISION = 'a0bfb468d42be831b126632fd8a0ae6b3614f981'
UEVIEWER_MATERIAL_HEADER_PATH = 'Unreal/UnrealMaterial/UnMaterial2.h'
UEVIEWER_MATERIAL_HEADER_SHA256 = '9e27b80d6f8c2625decba49745bd65a7f3e54abd957ee7a627e3f4bdb3d8b0c9'


def layout_evidence(source, commit, file, sha256, section):
    return {'source': source, 'commit': commit, 'file': file, 'sha256': sha256, 'section': section}


MATERIAL_PREFIX_EVIDENCE = (
    layout_evidence(ELBERA_SOURCE_NAME, ELBERA_COMMIT, ELBERA_L2LIB_README_PATH, ELBERA_L2LIB_README_SHA256,
                    'Lineage2 UMaterial extra fields (v123 packages); Texture export body'),
    layout_evidence(UEVIEWER_REPOSITORY, UEVIEWER_REVISION, UEVIEWER_MATERIAL_HEADER_PATH, UEVIEWER_MATERIAL_HEADER_SHA256,
                    'UMaterial::Serialize LINEAGE2 block, secondary reference cited by repository and revision'),
)


def lineage_material_prefix(package_version, licensee_version):
    if package_version < LINEAGE_MATERIAL_MINIMUM_PACKAGE_VERSION or licensee_version not in LINEAGE_RESERVED_INT32_LICENSEES:
        return NO_MATERIAL_PREFIX
    if licensee_version in LINEAGE_SHADER_BLOCK_LICENSEES:
        return SHADER_BLOCK_MATERIAL_PREFIX
    return RESERVED_INT32_MATERIAL_PREFIX
