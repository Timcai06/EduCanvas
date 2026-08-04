import csv
import json
import math
import os
import pathlib
import random
import socket

RANDOM_SEED = 20260804
INPUT = pathlib.Path('/experiment/inputs/data/data')
OUTPUT = pathlib.Path('/experiment/output')


def network_is_blocked():
    try:
        connection = socket.create_connection(('1.1.1.1', 53), timeout=0.25)
        connection.close()
        return False
    except OSError:
        return True


def gpu_is_visible():
    device_nodes = ['/dev/nvidia0', '/dev/nvidiactl', '/dev/kfd']
    return any(pathlib.Path(path).exists() for path in device_nodes) or bool(
        os.environ.get('NVIDIA_VISIBLE_DEVICES')
    )


with INPUT.open(newline='', encoding='utf-8') as source:
    rows = [(float(row['x']), float(row['y'])) for row in csv.DictReader(source)]

indices = list(range(len(rows)))
random.Random(RANDOM_SEED).shuffle(indices)
train_indices = sorted(indices[:4])
training = [rows[index] for index in train_indices]

mean_x = sum(x for x, _ in training) / len(training)
mean_y = sum(y for _, y in training) / len(training)
numerator = sum((x - mean_x) * (y - mean_y) for x, y in training)
denominator = sum((x - mean_x) ** 2 for x, _ in training)
slope = numerator / denominator
intercept = mean_y - slope * mean_x
predictions = [(x, y, slope * x + intercept) for x, y in rows]
rmse = math.sqrt(
    sum((prediction - actual) ** 2 for _, actual, prediction in predictions)
    / len(predictions)
)

metrics = {
    'gpu_visible': gpu_is_visible(),
    'intercept': round(intercept, 6),
    'network_blocked': network_is_blocked(),
    'random_seed': RANDOM_SEED,
    'rmse': round(rmse, 6),
    'slope': round(slope, 6),
    'train_indices': train_indices,
}

OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'metrics.json').write_text(
    json.dumps(metrics, ensure_ascii=True, separators=(',', ':'), sort_keys=True)
    + '\n',
    encoding='utf-8',
)
with (OUTPUT / 'predictions.csv').open('w', newline='', encoding='utf-8') as target:
    writer = csv.writer(target, lineterminator='\n')
    writer.writerow(['x', 'actual', 'prediction'])
    for x, actual, prediction in predictions:
        writer.writerow([f'{x:.1f}', f'{actual:.1f}', f'{prediction:.1f}'])

print('experiment_complete')
