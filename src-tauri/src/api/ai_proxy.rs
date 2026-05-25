use crate::kernel::error::CommandError;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGetJsonRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAudioTranscriptionRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    file_name: String,
    mime_type: String,
    base64_data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTextToSpeechRequest {
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Value,
    output_dir: Option<String>,
    file_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTextToSpeechResult {
    path: String,
    file_name: String,
}

/// Returns true if the IPv4 address is in a blocked range (private, loopback, reserved).
fn is_blocked_v4(v4: Ipv4Addr) -> bool {
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_unspecified()
        || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
}

/// Returns true if the IP address is in a blocked range (private, loopback, reserved).
/// Handles IPv4-mapped IPv6 addresses by checking the mapped IPv4 against blocked ranges.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.segments()[0] & 0xffc0 == 0xfe80 // link-local fe80::/10
                || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
                || v6.to_ipv4().is_some_and(is_blocked_v4) // IPv4-mapped/compatible
        }
    }
}

pub(crate) fn validate_ai_url(url: &str) -> Result<(), CommandError> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(CommandError {
            code: "INVALID_AI_ENDPOINT".into(),
            message: "AI endpoint must start with http:// or https://".into(),
        });
    }

    let parsed = url::Url::parse(url).map_err(|_| CommandError {
        code: "INVALID_AI_ENDPOINT".into(),
        message: "Invalid URL format".into(),
    })?;

    let host = parsed
        .host_str()
        .ok_or_else(|| CommandError {
            code: "INVALID_AI_ENDPOINT".into(),
            message: "URL has no host".into(),
        })?
        .to_ascii_lowercase();
    // Strip brackets from IPv6 addresses so parse::<IpAddr>() succeeds
    let host_ip_str = host.strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(&host);

    // Block reserved / loopback hostnames
    if matches!(
        host.as_str(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "[::1]"
    ) {
        return Err(CommandError {
            code: "INVALID_AI_ENDPOINT".into(),
            message: "Requests to loopback addresses are not allowed".into(),
        });
    }

    // Block cloud metadata endpoint
    if host == "169.254.169.254" {
        return Err(CommandError {
            code: "INVALID_AI_ENDPOINT".into(),
            message: "Requests to cloud metadata endpoint are not allowed".into(),
        });
    }

    // If the host parses as an IP, check private / link-local ranges
    if let Ok(ip) = host_ip_str.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err(CommandError {
                code: "INVALID_AI_ENDPOINT".into(),
                message: "Requests to private / reserved IP addresses are not allowed".into(),
            });
        }
    }

    // DNS rebinding protection: resolve hostnames and check resolved IPs.
    // If DNS resolution fails (e.g. internal hostname, network down), allow —
    // no rebinding risk if the domain can't resolve in the first place.
    if host_ip_str.parse::<IpAddr>().is_err() {
        let port = parsed.port_or_known_default().unwrap_or(443);
        if let Ok(addrs) = (host.as_str(), port).to_socket_addrs() {
            for addr in addrs {
                if is_blocked_ip(addr.ip()) {
                    return Err(CommandError {
                        code: "INVALID_AI_ENDPOINT".into(),
                        message: "Resolved IP address is in a private / reserved range".into(),
                    });
                }
            }
        }
    }

    Ok(())
}

pub(crate) fn build_ai_headers(
    custom_headers: Option<HashMap<String, String>>,
    include_content_type: bool,
) -> Result<HeaderMap, CommandError> {
    let mut headers = HeaderMap::new();
    if include_content_type {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    if let Some(custom_headers) = custom_headers {
        for (name, value) in custom_headers {
            let header_name =
                HeaderName::from_bytes(name.as_bytes()).map_err(|e| CommandError {
                    code: "INVALID_AI_HEADER".into(),
                    message: e.to_string(),
                })?;
            let header_value = HeaderValue::from_str(&value).map_err(|e| CommandError {
                code: "INVALID_AI_HEADER".into(),
                message: e.to_string(),
            })?;
            headers.insert(header_name, header_value);
        }
    }
    Ok(headers)
}

pub(crate) fn ai_provider_status_error(status: reqwest::StatusCode, text: String) -> CommandError {
    CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: format!(
            "{}{}",
            status.as_u16(),
            if text.is_empty() {
                String::new()
            } else {
                format!(": {}", text)
            }
        ),
    }
}

fn default_audio_output_dir(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    if let Some(dir) = dirs::audio_dir().or_else(dirs::download_dir) {
        return Ok(dir.join("MindZJ"));
    }
    let app_dir = app.path().app_data_dir().map_err(|e| CommandError {
        code: "APP_DIR_ERROR".into(),
        message: e.to_string(),
    })?;
    Ok(app_dir.join("audio"))
}

fn resolve_audio_output_dir(
    app: &tauri::AppHandle,
    output_dir: Option<String>,
) -> Result<PathBuf, CommandError> {
    if let Some(raw) = output_dir {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    default_audio_output_dir(app)
}

pub(crate) fn sanitize_audio_file_name(raw: Option<String>) -> String {
    let fallback = format!(
        "mindzj_grok_tts_{}.mp3",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let source = raw
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback);
    let mut result: String = source
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    while result.starts_with('.') || result.starts_with('_') {
        result.remove(0);
    }
    if result.is_empty() {
        result = fallback;
    }
    if !result.to_ascii_lowercase().ends_with(".mp3") {
        result.push_str(".mp3");
    }
    result
}

#[tauri::command]
pub async fn ai_chat_completion(request: AiChatCompletionRequest) -> Result<Value, CommandError> {
    let url = request.url.trim();
    validate_ai_url(url)?;
    let headers = build_ai_headers(request.headers, true)?;

    let response = reqwest::Client::new()
        .post(url)
        .headers(headers)
        .json(&request.body)
        .send()
        .await
        .map_err(|e| CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: e.to_string(),
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: e.to_string(),
    })?;

    if !status.is_success() {
        return Err(CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: format!(
                "{}{}",
                status.as_u16(),
                if text.is_empty() {
                    String::new()
                } else {
                    format!(": {}", text)
                }
            ),
        });
    }

    serde_json::from_str(&text).map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: format!("Invalid AI response JSON: {}", e),
    })
}

#[tauri::command]
pub async fn ai_get_json(request: AiGetJsonRequest) -> Result<Value, CommandError> {
    let url = request.url.trim();
    validate_ai_url(url)?;
    let headers = build_ai_headers(request.headers, false)?;

    let response = reqwest::Client::new()
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: e.to_string(),
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: e.to_string(),
    })?;

    if !status.is_success() {
        return Err(CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: format!(
                "{}{}",
                status.as_u16(),
                if text.is_empty() {
                    String::new()
                } else {
                    format!(": {}", text)
                }
            ),
        });
    }

    serde_json::from_str(&text).map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: format!("Invalid AI response JSON: {}", e),
    })
}

#[tauri::command]
pub async fn ai_transcribe_audio(
    request: AiAudioTranscriptionRequest,
) -> Result<Value, CommandError> {
    let url = request.url.trim();
    validate_ai_url(url)?;
    let headers = build_ai_headers(request.headers, false)?;
    let data = base64::engine::general_purpose::STANDARD
        .decode(&request.base64_data)
        .map_err(|e| CommandError {
            code: "DECODE_ERROR".into(),
            message: format!("Failed to decode audio data: {}", e),
        })?;
    let file_name = request.file_name.trim();
    let file_name = if file_name.is_empty() {
        "mindzj-recording.wav"
    } else {
        file_name
    };
    let mime_type = request.mime_type.trim();
    let mime_type = if mime_type.is_empty() {
        "audio/wav"
    } else {
        mime_type
    };
    let file_part = reqwest::multipart::Part::bytes(data)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: e.to_string(),
        })?;
    let form = reqwest::multipart::Form::new().part("file", file_part);

    let response = reqwest::Client::new()
        .post(url)
        .headers(headers)
        .multipart(form)
        .send()
        .await
        .map_err(|e| CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: e.to_string(),
        })?;

    let status = response.status();
    let text = response.text().await.map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: e.to_string(),
    })?;

    if !status.is_success() {
        return Err(ai_provider_status_error(status, text));
    }

    serde_json::from_str(&text).map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: format!("Invalid STT response JSON: {}", e),
    })
}

#[tauri::command]
pub async fn ai_text_to_speech(
    app: tauri::AppHandle,
    request: AiTextToSpeechRequest,
) -> Result<AiTextToSpeechResult, CommandError> {
    let url = request.url.trim();
    validate_ai_url(url)?;
    let headers = build_ai_headers(request.headers, true)?;

    let response = reqwest::Client::new()
        .post(url)
        .headers(headers)
        .json(&request.body)
        .send()
        .await
        .map_err(|e| CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: e.to_string(),
        })?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ai_provider_status_error(status, text));
    }

    let bytes = response.bytes().await.map_err(|e| CommandError {
        code: "AI_PROVIDER_ERROR".into(),
        message: e.to_string(),
    })?;
    if bytes.is_empty() {
        return Err(CommandError {
            code: "AI_PROVIDER_ERROR".into(),
            message: "TTS response contained no audio data".into(),
        });
    }

    let output_dir = resolve_audio_output_dir(&app, request.output_dir)?;
    std::fs::create_dir_all(&output_dir).map_err(|e| CommandError {
        code: "IO_ERROR".into(),
        message: format!("Failed to create audio export folder: {}", e),
    })?;
    let file_name = sanitize_audio_file_name(request.file_name);
    let output_path = output_dir.join(&file_name);
    std::fs::write(&output_path, bytes.as_ref()).map_err(|e| CommandError {
        code: "IO_ERROR".into(),
        message: format!("Failed to write audio file: {}", e),
    })?;

    Ok(AiTextToSpeechResult {
        path: output_path.to_string_lossy().to_string(),
        file_name,
    })
}

#[cfg(test)]
mod tests {
    //! Unit tests for the AI proxy module.
    //!
    //! These tests exercise the pure-logic helper functions that do NOT require
    //! network access or a running Tauri application:
    //!
    //!   - `validate_ai_url`      — URL scheme validation
    //!   - `build_ai_headers`     — HTTP header construction
    //!   - `ai_provider_status_error` — error formatting from HTTP status codes
    //!   - `sanitize_audio_file_name` — file name normalisation for TTS output
    //!
    //! The Tauri command handlers (`ai_chat_completion`, `ai_get_json`,
    //! `ai_transcribe_audio`, `ai_text_to_speech`) are thin wrappers around
    //! `reqwest::Client` and are covered by integration / smoke tests elsewhere.

    use super::*;
    use std::collections::HashMap;

    // -----------------------------------------------------------------------
    // validate_ai_url
    // -----------------------------------------------------------------------

    mod validate_ai_url_tests {
        use super::*;

        // -- Happy paths (must accept) --------------------------------------

        #[test]
        fn accepts_plain_http_url() {
            assert!(validate_ai_url("http://example.com:11434/api/chat").is_ok());
        }

        #[test]
        fn accepts_https_url() {
            assert!(validate_ai_url("https://api.openai.com/v1/chat/completions").is_ok());
        }

        #[test]
        fn accepts_https_with_port() {
            assert!(validate_ai_url("https://example.com:8443/v1/generate").is_ok());
        }

        #[test]
        fn accepts_http_with_path_and_query() {
            assert!(validate_ai_url("http://example.com:3000/api?key=secret").is_ok());
        }

        #[test]
        fn accepts_common_provider_urls() {
            // All major AI providers and local servers
            let urls = [
                "https://api.openai.com/v1/chat/completions",
                "https://api.anthropic.com/v1/messages",
                "https://generativelanguage.googleapis.com/v1/models",
                "https://my-instance.openai.azure.com/openai/deployments",
                "https://api.deepseek.com/v1/chat/completions",
                "https://api.groq.com/openai/v1/chat/completions",
                "https://api.together.xyz/v1/chat/completions",
                "http://example.com:8080/v1/chat/completions",
            ];
            for url in urls {
                assert!(validate_ai_url(url).is_ok(), "should accept: {url}");
            }
        }

        #[test]
        fn rejects_localhost() {
            let err = validate_ai_url("http://localhost:11434/api/chat").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_loopback_ip() {
            let err = validate_ai_url("http://127.0.0.1:3000/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_private_ip_10() {
            let err = validate_ai_url("http://10.0.0.1/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_private_ip_172() {
            let err = validate_ai_url("http://172.16.0.1/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_private_ip_192() {
            let err = validate_ai_url("http://192.168.1.100:8080/v1/chat").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_cloud_metadata() {
            let err = validate_ai_url("http://169.254.169.254/latest/meta-data/").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        // -- Rejection paths ------------------------------------------------

        #[test]
        fn rejects_empty_string() {
            let err = validate_ai_url("").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
            assert!(err.message.contains("http://"));
        }

        #[test]
        fn rejects_ftp_scheme() {
            let err = validate_ai_url("ftp://example.com/file").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_file_scheme() {
            let err = validate_ai_url("file:///etc/passwd").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_javascript_scheme() {
            let err = validate_ai_url("javascript:alert(1)").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_bare_hostname() {
            // No scheme at all — just a hostname
            let err = validate_ai_url("api.openai.com/v1/chat/completions").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_bare_path() {
            let err = validate_ai_url("/v1/chat/completions").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_http_prefix_that_is_not_a_scheme() {
            // "httpfoo" starts with "http" but not "http://"
            let err = validate_ai_url("httpfoo://bar").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_data_uri() {
            let err = validate_ai_url("data:text/plain,hello").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn error_message_contains_helpful_hint() {
            let err = validate_ai_url("ws://socket").unwrap_err();
            assert!(
                err.message.contains("http://") || err.message.contains("https://"),
                "error should hint at accepted schemes, got: {}",
                err.message
            );
        }
        #[test]
        fn rejects_ipv6_mapped_loopback() {
            let err = validate_ai_url("http://[::ffff:127.0.0.1]:11434/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_ipv6_mapped_private_ip() {
            let err = validate_ai_url("http://[::ffff:10.0.0.1]/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_ipv6_unique_local() {
            let err = validate_ai_url("http://[fd00::1]:8080/api").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }

        #[test]
        fn rejects_ipv6_mapped_metadata() {
            let err = validate_ai_url("http://[::ffff:169.254.169.254]/latest/").unwrap_err();
            assert_eq!(err.code, "INVALID_AI_ENDPOINT");
        }
    }

    // -----------------------------------------------------------------------
    // build_ai_headers
    // -----------------------------------------------------------------------

    mod build_ai_headers_tests {
        use super::*;
        use reqwest::header::{CONTENT_TYPE, HeaderValue};

        // -- Happy paths ----------------------------------------------------

        #[test]
        fn no_custom_headers_with_content_type() {
            let headers = build_ai_headers(None, true).unwrap();
            assert_eq!(
                headers.get(CONTENT_TYPE).unwrap(),
                HeaderValue::from_static("application/json")
            );
            assert_eq!(headers.len(), 1);
        }

        #[test]
        fn no_custom_headers_without_content_type() {
            let headers = build_ai_headers(None, false).unwrap();
            assert!(headers.is_empty());
        }

        #[test]
        fn custom_headers_are_included() {
            let mut custom = HashMap::new();
            custom.insert("Authorization".into(), "Bearer sk-test".into());
            custom.insert("X-Custom".into(), "value".into());

            let headers = build_ai_headers(Some(custom), false).unwrap();
            assert_eq!(
                headers.get("Authorization").unwrap(),
                HeaderValue::from_static("Bearer sk-test")
            );
            assert_eq!(
                headers.get("X-Custom").unwrap(),
                HeaderValue::from_static("value")
            );
            // No content-type because include_content_type=false
            assert!(headers.get(CONTENT_TYPE).is_none());
        }

        #[test]
        fn custom_headers_combined_with_content_type() {
            let mut custom = HashMap::new();
            custom.insert("Authorization".into(), "Bearer sk-key".into());

            let headers = build_ai_headers(Some(custom), true).unwrap();
            assert_eq!(
                headers.get(CONTENT_TYPE).unwrap(),
                HeaderValue::from_static("application/json")
            );
            assert_eq!(
                headers.get("Authorization").unwrap(),
                HeaderValue::from_static("Bearer sk-key")
            );
            assert_eq!(headers.len(), 2);
        }

        #[test]
        fn empty_custom_headers_map_with_content_type() {
            let headers = build_ai_headers(Some(HashMap::new()), true).unwrap();
            assert_eq!(
                headers.get(CONTENT_TYPE).unwrap(),
                HeaderValue::from_static("application/json")
            );
            assert_eq!(headers.len(), 1);
        }

        #[test]
        fn anthropic_specific_headers() {
            // Anthropic uses x-api-key instead of Authorization
            let mut custom = HashMap::new();
            custom.insert("x-api-key".into(), "sk-ant-test".into());
            custom.insert("anthropic-version".into(), "2023-06-01".into());

            let headers = build_ai_headers(Some(custom), true).unwrap();
            assert_eq!(
                headers.get("x-api-key").unwrap(),
                HeaderValue::from_static("sk-ant-test")
            );
            assert_eq!(
                headers.get("anthropic-version").unwrap(),
                HeaderValue::from_static("2023-06-01")
            );
        }

        #[test]
        fn ollama_typically_no_auth_headers() {
            // Ollama usually needs no auth, just content type
            let headers = build_ai_headers(None, true).unwrap();
            assert!(headers.get("Authorization").is_none());
            assert_eq!(
                headers.get(CONTENT_TYPE).unwrap(),
                HeaderValue::from_static("application/json")
            );
        }

        // -- Error paths ----------------------------------------------------

        #[test]
        fn invalid_header_name_returns_error() {
            let mut custom = HashMap::new();
            // Header names cannot contain spaces
            custom.insert("Bad Header".into(), "value".into());

            let err = build_ai_headers(Some(custom), false).unwrap_err();
            assert_eq!(err.code, "INVALID_AI_HEADER");
        }

        #[test]
        fn invalid_header_value_returns_error() {
            let mut custom = HashMap::new();
            // Header values cannot contain newlines (header injection)
            custom.insert("Authorization".into(), "Bearer\nInjected".into());

            let err = build_ai_headers(Some(custom), false).unwrap_err();
            assert_eq!(err.code, "INVALID_AI_HEADER");
        }

        #[test]
        fn empty_header_name_returns_error() {
            let mut custom = HashMap::new();
            custom.insert("".into(), "value".into());

            let err = build_ai_headers(Some(custom), false).unwrap_err();
            assert_eq!(err.code, "INVALID_AI_HEADER");
        }

        #[test]
        fn first_invalid_header_stops_iteration() {
            // If there are multiple custom headers, the first bad one should be
            // the one reported (HashMap iteration order may vary, but we should
            // get *an* error).
            let mut custom = HashMap::new();
            custom.insert("Good-Header".into(), "ok".into());
            custom.insert("Bad\x01Header".into(), "value".into());

            let err = build_ai_headers(Some(custom), false).unwrap_err();
            assert_eq!(err.code, "INVALID_AI_HEADER");
        }
    }

    // -----------------------------------------------------------------------
    // ai_provider_status_error
    // -----------------------------------------------------------------------

    mod ai_provider_status_error_tests {
        use super::*;
        use reqwest::StatusCode;

        #[test]
        fn formats_400_bad_request() {
            let err = ai_provider_status_error(
                StatusCode::BAD_REQUEST,
                "invalid request body".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "400: invalid request body");
        }

        #[test]
        fn formats_401_unauthorized() {
            let err = ai_provider_status_error(
                StatusCode::UNAUTHORIZED,
                "Invalid API key".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "401: Invalid API key");
        }

        #[test]
        fn formats_403_forbidden() {
            let err = ai_provider_status_error(
                StatusCode::FORBIDDEN,
                "Access denied".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "403: Access denied");
        }

        #[test]
        fn formats_404_not_found() {
            let err = ai_provider_status_error(
                StatusCode::NOT_FOUND,
                "Model not found".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "404: Model not found");
        }

        #[test]
        fn formats_429_rate_limited() {
            let err = ai_provider_status_error(
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "429: Rate limit exceeded");
        }

        #[test]
        fn formats_500_server_error() {
            let err = ai_provider_status_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "500: Internal error");
        }

        #[test]
        fn formats_502_bad_gateway() {
            let err = ai_provider_status_error(
                StatusCode::BAD_GATEWAY,
                "".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            // Empty text — no colon separator
            assert_eq!(err.message, "502");
        }

        #[test]
        fn empty_text_omits_separator() {
            let err = ai_provider_status_error(
                StatusCode::SERVICE_UNAVAILABLE,
                String::new(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "503");
        }

        #[test]
        fn nonempty_text_includes_separator() {
            let err = ai_provider_status_error(
                StatusCode::from_u16(418).unwrap(),
                "I'm a teapot".into(),
            );
            assert_eq!(err.code, "AI_PROVIDER_ERROR");
            assert_eq!(err.message, "418: I'm a teapot");
        }

        #[test]
        fn all_errors_share_ai_provider_error_code() {
            // The code is always AI_PROVIDER_ERROR regardless of status
            let codes: Vec<_> = [400u16, 401, 403, 404, 429, 500, 502, 503]
                .iter()
                .map(|&s| {
                    ai_provider_status_error(StatusCode::from_u16(s).unwrap(), "x".into()).code
                })
                .collect();
            assert!(codes.iter().all(|c| c == "AI_PROVIDER_ERROR"));
        }
    }

    // -----------------------------------------------------------------------
    // sanitize_audio_file_name
    // -----------------------------------------------------------------------

    mod sanitize_audio_file_name_tests {
        use super::*;

        // -- Happy paths ----------------------------------------------------

        #[test]
        fn valid_name_preserved() {
            let result = sanitize_audio_file_name(Some("my-audio.mp3".into()));
            assert_eq!(result, "my-audio.mp3");
        }

        #[test]
        fn valid_name_without_mp3_gets_extension() {
            let result = sanitize_audio_file_name(Some("my-audio".into()));
            assert_eq!(result, "my-audio.mp3");
        }

        #[test]
        fn name_with_mp3_uppercase_gets_normalized() {
            // The function checks .to_ascii_lowercase().ends_with(".mp3")
            let result = sanitize_audio_file_name(Some("my-audio.MP3".into()));
            assert_eq!(result, "my-audio.MP3");
        }

        #[test]
        fn special_chars_replaced_with_underscores() {
            let result = sanitize_audio_file_name(Some("my audio file!.mp3".into()));
            // spaces and ! become _
            assert_eq!(result, "my_audio_file_.mp3");
        }

        #[test]
        fn dots_and_hyphens_preserved() {
            let result = sanitize_audio_file_name(Some("v1.2-beta.mp3".into()));
            assert_eq!(result, "v1.2-beta.mp3");
        }

        #[test]
        fn leading_dots_stripped() {
            let result = sanitize_audio_file_name(Some("..hidden.mp3".into()));
            assert_eq!(result, "hidden.mp3");
        }

        #[test]
        fn leading_underscores_stripped() {
            let result = sanitize_audio_file_name(Some("__internal.mp3".into()));
            assert_eq!(result, "internal.mp3");
        }

        #[test]
        fn unicode_chars_replaced() {
            let result = sanitize_audio_file_name(Some("résumé.mp3".into()));
            // non-ASCII chars become _
            assert_eq!(result, "r_sum_.mp3");
        }

        // -- Edge cases -----------------------------------------------------

        #[test]
        fn none_returns_fallback_with_timestamp() {
            let result = sanitize_audio_file_name(None);
            assert!(result.starts_with("mindzj_grok_tts_"));
            assert!(result.ends_with(".mp3"));
        }

        #[test]
        fn empty_string_returns_fallback() {
            let result = sanitize_audio_file_name(Some("".into()));
            assert!(result.starts_with("mindzj_grok_tts_"));
            assert!(result.ends_with(".mp3"));
        }

        #[test]
        fn whitespace_only_returns_fallback() {
            // Whitespace chars are all replaced with _, then leading _ stripped
            let result = sanitize_audio_file_name(Some("   ".into()));
            // "   " -> "___" -> stripped -> "" -> fallback
            assert!(result.starts_with("mindzj_grok_tts_"));
            assert!(result.ends_with(".mp3"));
        }

        #[test]
        fn only_special_chars_returns_fallback() {
            // All chars replaced with _, then all stripped -> empty -> fallback
            let result = sanitize_audio_file_name(Some("!!!".into()));
            assert!(result.starts_with("mindzj_grok_tts_"));
            assert!(result.ends_with(".mp3"));
        }

        #[test]
        fn only_dots_returns_fallback() {
            // "." is preserved but leading dots are stripped
            let result = sanitize_audio_file_name(Some("...".into()));
            // "...". chars: each '.' is preserved -> "..."
            // leading dots stripped -> "" -> fallback
            assert!(result.starts_with("mindzj_grok_tts_"));
            assert!(result.ends_with(".mp3"));
        }

        #[test]
        fn mp3_extension_not_doubled() {
            let result = sanitize_audio_file_name(Some("output.mp3".into()));
            assert_eq!(result, "output.mp3");
            // Should NOT be "output.mp3.mp3"
            assert!(!result.contains(".mp3.mp3"));
        }

        #[test]
        fn non_mp3_extension_gets_mp3_appended() {
            let result = sanitize_audio_file_name(Some("output.wav".into()));
            assert_eq!(result, "output.wav.mp3");
        }

        #[test]
        fn long_name_preserved() {
            let long_name = format!("{}.mp3", "a".repeat(200));
            let result = sanitize_audio_file_name(Some(long_name.clone()));
            assert_eq!(result, long_name);
        }

        // -- Provider detection / URL family tests --------------------------
        //
        // The proxy itself is provider-agnostic: it accepts any http/https URL
        // and forwards requests transparently. There is no explicit "provider
        // detection" function. What we CAN test is that URLs belonging to
        // different provider families all pass URL validation — confirming the
        // proxy does not accidentally reject a specific provider.

        #[test]
        fn provider_family_urls_all_accepted() {
            let provider_urls = [
                // OpenAI
                "https://api.openai.com/v1/chat/completions",
                // Anthropic (via OpenAI-compatible proxy or direct)
                "https://api.anthropic.com/v1/messages",
                // Google Gemini
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent",
                // Azure OpenAI
                "https://my-resource.openai.azure.com/openai/deployments/my-model/chat/completions?api-version=2024-02-15-preview",
                // Groq
                "https://api.groq.com/openai/v1/chat/completions",
                // Together AI
                "https://api.together.xyz/v1/chat/completions",
                // DeepSeek
                "https://api.deepseek.com/v1/chat/completions",
                // Mistral
                "https://api.mistral.ai/v1/chat/completions",
                // Cohere
                "https://api.cohere.ai/v1/chat",
                // Custom endpoint
                "http://example.com:8080/v1/chat/completions",
            ];

            for url in provider_urls {
                assert!(
                    validate_ai_url(url).is_ok(),
                    "provider URL should be accepted: {url}"
                );
            }
        }
    }
}
