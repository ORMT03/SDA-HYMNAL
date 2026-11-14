#!/usr/bin/env python3
"""Copy the current reviewed English collection into the beta without using Git."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
import xml.etree.ElementTree as ET

beta = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', nargs='?', type=Path,
                    default=beta.parents[2] / 'outputs' / 'SDA_Hymnal_Reviewed')
args = parser.parse_args()
source = args.source.resolve()
files = sorted(source.glob('*.musicxml'))
if not files:
    parser.error(f'No reviewed MusicXML files found in {source}')
catalog = {song['number'] for song in json.loads((beta.parent / 'songs.json').read_text())}
manifest = json.loads((beta / 'scores.json').read_text())
old_paths = {value for key, value in manifest.items() if key.startswith('english:')}
manifest = {key: value for key, value in manifest.items() if not key.startswith('english:')}
records = []
# Validate the full snapshot before changing the website.
for file in files:
    match = re.match(r'^(\d{3})_', file.name)
    if not match or match[1] not in catalog:
        raise ValueError(f'No catalog match: {file.name}')
    key = f'english:{match[1]}'
    if key in manifest:
        raise ValueError(f'Duplicate hymn: {file.name}')
    data = file.read_bytes()
    if ET.fromstring(data).tag != 'score-partwise':
        raise ValueError(f'Unsupported score: {file.name}')
    manifest[key] = f'musicxml/English/{file.name}'
    records.append((file, data, {'number': match[1], 'file': file.name,
                              'sha256': hashlib.sha256(data).hexdigest()}))
target = beta / 'musicxml' / 'English'
target.mkdir(parents=True, exist_ok=True)
for file, data, record in records:
    (target / file.name).write_bytes(data)
for value in old_paths - set(manifest.values()):
    old_file = (beta / value).resolve()
    if old_file.parent == target.resolve() and old_file.exists():
        old_file.unlink()
(beta / 'scores.json').write_text(json.dumps(manifest, indent=2) + '\n')
(beta / 'score-sources.json').write_text(json.dumps({
    'source': 'outputs/SDA_Hymnal_Reviewed', 'language': 'english',
    'scores': [record for _, _, record in records]
}, indent=2) + '\n')
print(f'Included {len(records)} reviewed English scores. No commit or push performed.')
