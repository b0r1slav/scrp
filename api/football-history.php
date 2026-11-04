<?php
// One-off historical result proxy using Football-Data.co.uk's free downloadable CSVs.
ini_set('display_errors', '0');
ini_set('log_errors', '1');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$competitions = [
    'PL' => ['name' => 'Premier League', 'file' => 'E0'],
    'PD' => ['name' => 'La Liga', 'file' => 'SP1'],
    'BL1' => ['name' => 'Bundesliga', 'file' => 'D1'],
    'SA' => ['name' => 'Serie A', 'file' => 'I1'],
];
$code = strtoupper((string) ($_GET['competition'] ?? ''));
$season = filter_var($_GET['season'] ?? null, FILTER_VALIDATE_INT);
$currentYear = (int) gmdate('Y');
if (!isset($competitions[$code]) || $season === false || $season < 1993 || $season > $currentYear) {
    http_response_code(400);
    echo json_encode(['error' => 'Choose a supported competition and season start year from 1993 through ' . $currentYear . '.']);
    exit;
}

$seasonCode = sprintf('%02d%02d', $season % 100, ($season + 1) % 100);
$cachePath = sys_get_temp_dir() . '/baseline-football-history-csv-v1-' . $code . '-' . $season . '.json';
// Keep these historical responses locally so opening the report again does not redownload them.
if (is_file($cachePath) && time() - filemtime($cachePath) < 31536000) {
    readfile($cachePath);
    exit;
}

$url = 'https://www.football-data.co.uk/mmz4281/' . $seasonCode . '/' . $competitions[$code]['file'] . '.csv';
if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => 'Baseline historical football report', CURLOPT_TIMEOUT => 30]);
    $csv = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    // Do not call curl_close(): it is a no-op and deprecated on PHP 8.5+.
    if ($csv === false) {
        http_response_code(502);
        echo json_encode(['error' => $error ?: 'Could not download the historical results file']);
        exit;
    }
} else {
    $context = stream_context_create(['http' => ['method' => 'GET', 'header' => "User-Agent: Baseline historical football report\r\nAccept: text/csv\r\n", 'timeout' => 30, 'ignore_errors' => true]]);
    $csv = @file_get_contents($url, false, $context);
    $status = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $m)) $status = (int) $m[1];
    }
    if ($csv === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Could not download the historical results file']);
        exit;
    }
}

if ($status < 200 || $status >= 300) {
    http_response_code($status >= 400 && $status < 600 ? $status : 502);
    echo json_encode(['error' => 'The free results archive returned HTTP ' . $status . ' for ' . $competitions[$code]['name'] . ' ' . $seasonCode . '.']);
    exit;
}
if (preg_match('//u', $csv) !== 1 && function_exists('iconv')) {
    $csv = iconv('Windows-1252', 'UTF-8//IGNORE', $csv) ?: $csv;
}

$stream = fopen('php://temp', 'r+');
fwrite($stream, $csv);
rewind($stream);
$headers = fgetcsv($stream, null, ',', '"', '\\');
if (!is_array($headers)) {
    fclose($stream);
    http_response_code(502);
    echo json_encode(['error' => 'The historical results file was empty or invalid']);
    exit;
}
$headers = array_map(static function ($header) {
    return strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $header)));
}, $headers);
$column = array_flip($headers);
foreach (['date', 'hometeam', 'awayteam', 'fthg', 'ftag'] as $required) {
    if (!isset($column[$required])) {
        fclose($stream);
        http_response_code(502);
        echo json_encode(['error' => 'The results CSV did not contain the expected full-time score columns']);
        exit;
    }
}

$matches = [];
while (($row = fgetcsv($stream, null, ',', '"', '\\')) !== false) {
    if (count($row) < count($headers)) continue;
    $dateText = trim((string) $row[$column['date']]);
    $home = trim((string) $row[$column['hometeam']]);
    $away = trim((string) $row[$column['awayteam']]);
    $homeGoals = trim((string) $row[$column['fthg']]);
    $awayGoals = trim((string) $row[$column['ftag']]);
    if ($dateText === '' || $home === '' || $away === '' || !preg_match('/^\d+$/', $homeGoals) || !preg_match('/^\d+$/', $awayGoals)) continue;

    $date = DateTime::createFromFormat('!d/m/y', $dateText) ?: DateTime::createFromFormat('!d/m/Y', $dateText);
    if (!$date) continue;
    $matches[] = [
        'utcDate' => $date->format('Y-m-d') . 'T00:00:00Z',
        'status' => 'FINISHED',
        'homeTeam' => ['name' => $home],
        'awayTeam' => ['name' => $away],
        'score' => ['fullTime' => ['home' => (int) $homeGoals, 'away' => (int) $awayGoals]],
    ];
}
fclose($stream);

$result = json_encode([
    'season' => $season,
    'competition' => $code,
    'competitionName' => $competitions[$code]['name'],
    'source' => 'Football-Data.co.uk',
    'matches' => $matches,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($result === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not encode football data']);
    exit;
}
@file_put_contents($cachePath, $result, LOCK_EX);
echo $result;
