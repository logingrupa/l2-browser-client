from pathlib import Path


def path_free_reason(message, source_root, output_root):
    for root, placeholder in ((source_root, '<source>'), (output_root, '<output>')):
        for spelling in {str(root), Path(root).as_posix()}:
            message = message.replace(spelling, placeholder)
    return ' '.join(message.split())
