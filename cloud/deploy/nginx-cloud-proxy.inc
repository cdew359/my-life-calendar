# Include inside the public /api/ and compatible /cloud-api/ locations.
if (-f /srv/calendar/shared-maintenance.flag) {
    return 503 '{"error":"正在升级，请稍后重试，本地数据已保留"}';
}
if ($calendar_cloud_backend = "") { return 404; }
add_header Access-Control-Allow-Origin "*" always;
add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
add_header Access-Control-Max-Age "600" always;
add_header X-Calendar-Backend "spring-cloud-nginx" always;
add_header Cache-Control "no-store" always;
add_header X-Content-Type-Options nosniff always;
if ($request_method = OPTIONS) { return 204; }
resolver 127.0.0.11 valid=5s;
proxy_pass http://$calendar_cloud_backend;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Account-Id "";
proxy_connect_timeout 5s;
proxy_send_timeout 15s;
client_max_body_size 2m;
proxy_intercept_errors on;
error_page 502 504 = @calendar_cloud_unavailable;
