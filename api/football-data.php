<?php
// Read-only, cached proxy for football-data.org. Configure FOOTBALL_DATA_TOKEN on the server.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$token = getenv('FOOTBALL_DATA_TOKEN');
if (!$token) {
    http_response_code(503);
    echo json_encode(['error' => 'Football API is not configured. Set FOOTBALL_DATA_TOKEN on the server.']);
    exit;
}

$leagues = [
    'PL' => 'Premier League',
    'PD' => 'La Liga',
    'BL1' => 'Bundesliga',
    'SA' => 'Serie A',
];
$cachePath = sys_get_temp_dir() . '/baseline-football-data-' . hash('sha256', implode(',', array_keys($leagues))) . '.json';
$cacheTtl = 900;
if (is_file($cachePath) && time() - filemtime($cachePath) < $cacheTtl) {
    readfile($cachePath);
    exit;
}

function fetchCompetition($code, $token) {
    $url = 'https://api.football-data.org/v4/competitions/' . rawurlencode($code) . '/matches?season=' . date('Y');
    $headers = "X-Auth-Token: " . $token . "\r\nAccept: application/json\r\n";
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => explode("\r\n", trim($headers)), CURLOPT_TIMEOUT => 20]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($body === false) throw new RuntimeException($error ?: 'Could not reach football-data.org');
    } else {
        $context = stream_context_create(['http' => ['method' => 'GET', 'header' => $headers, 'timeout' => 20, 'ignore_errors' => true]]);
        $body = @file_get_contents($url, false, $context);
        $status = 0;
        foreach ($http_response_header ?? [] as $header) if (preg_match('/^HTTP\/\S+\s+(\d+)/', $header, $m)) $status = (int) $m[1];
        if ($body === false) throw new RuntimeException('Could not reach football-data.org');
    }
    $data = json_decode($body, true);
    if ($status < 200 || $status >= 300) {
        $message = $data['message'] ?? ('football-data.org returned HTTP ' . $status);
        throw new RuntimeException($message, $status ?: 502);
    }
    if (!is_array($data['matches'] ?? null)) throw new RuntimeException('Unexpected response from football-data.org');
    return $data['matches'];
}

$result = ['season' => (int) date('Y'), 'updatedAt' => gmdate('c'), 'competitions' => []];
try {
    foreach ($leagues as $code => $name) {
        $result['competitions'][$code] = ['name' => $name, 'matches' => fetchCompetition($code, $token)];
    }
} catch (Throwable $error) {
    http_response_code((int) $error->getCode() >= 400 && (int) $error->getCode() < 600 ? (int) $error->getCode() : 502);
    echo json_encode(['error' => $error->getMessage()]);
    exit;
}
$json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Could not encode football data']);
    exit;
}
@file_put_contents($cachePath, $json, LOCK_EX);
echo $json;
