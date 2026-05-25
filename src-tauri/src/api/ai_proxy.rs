use crate::kernel::error::CommandError;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
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

pub fn validate_ai_url(url: &str) -> Result<(), CommandError> {
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
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_unspecified()
                    || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
            }
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || v6.segments()[0] & 0xffc0 == 0xfe80,
        };
        if blocked {
            return Err(CommandError {
                code: "INVALID_AI_ENDPOINT".into(),
                message: "Requests to private / reserved IP addresses are not allowed".into(),
            });
        }
    }

    // DNS rebinding protection: resolve hostnames and check resolved IPs.
    // If DNS resolution fails (e.g. internal hostname, network down), allow —
    // no rebinding risk if the domain can't resolve in the first place.
    if host.parse::<IpAddr>().is_err() {
        let port = parsed.port_or_known_default().unwrap_or(443);
        if let Ok(addrs) = (host.as_str(), port).to_socket_addrs() {
            for addr in addrs {
                let ip = addr.ip();
                let blocked = match ip {
                    IpAddr::V4(v4) => {
                        v4.is_loopback()
                            || v4.is_private()
                            || v4.is_link_local()
                            || v4.is_broadcast()
                            || v4.is_unspecified()
                            || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
                    }
                    IpAddr::V6(v6) => {
                        v6.is_loopback() || v6.is_unspecified() || v6.segments()[0] & 0xffc0 == 0xfe80
                    }
                };
                if blocked {
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

pub fn build_ai_headers(
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

pub fn ai_provider_status_error(status: reqwest::StatusCode, text: String) -> CommandError {
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

pub fn sanitize_audio_file_name(raw: Option<String>) -> String {
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
