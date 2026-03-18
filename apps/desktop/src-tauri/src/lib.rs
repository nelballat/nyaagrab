use std::{
    collections::HashMap,
    fs,
    process::Command,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::time::sleep;

use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, USER_AGENT},
    Client,
};
use rfd::FileDialog;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextResponse {
    text: Option<String>,
    error: Option<String>,
    error_kind: Option<String>,
    cache_status: Option<String>,
    throttled_count: u32,
}

#[derive(Serialize)]
struct TitleResponse {
    titles: Vec<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct SavedFileResponse {
    path: String,
}

static NYAA_CLIENT: OnceLock<Client> = OnceLock::new();
static ANILIST_CLIENT: OnceLock<Client> = OnceLock::new();
static RSS_CACHE: OnceLock<Mutex<HashMap<String, CachedRssEntry>>> = OnceLock::new();

struct CachedRssEntry {
    text: String,
    stored_at: Instant,
}

const RSS_CACHE_TTL: Duration = Duration::from_secs(600);

fn rss_cache() -> &'static Mutex<HashMap<String, CachedRssEntry>> {
    RSS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn build_nyaa_client() -> Result<Client, reqwest::Error> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("nyaagrab/0.1.0 (desktop)"));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"),
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .http1_only()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .tcp_keepalive(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
}

fn nyaa_client() -> Result<&'static Client, String> {
    if let Some(client) = NYAA_CLIENT.get() {
        return Ok(client);
    }

    let client = build_nyaa_client().map_err(|error| format!("client build failed: {error:#}"))?;
    let _ = NYAA_CLIENT.set(client);
    NYAA_CLIENT
        .get()
        .ok_or_else(|| "client initialization failed".to_string())
}

#[tauri::command]
async fn fetch_nyaa_rss(query: String, category: String, filter: String) -> TextResponse {
    let client = match nyaa_client() {
        Ok(client) => client,
        Err(error) => {
            return TextResponse {
                text: None,
                error: Some(error),
                error_kind: None,
                cache_status: None,
                throttled_count: 0,
            }
        }
    };

    let cache_key = format!("{query}\u{1f}{category}\u{1f}{filter}");
    let cached_text = {
        let mut cache = match rss_cache().lock() {
            Ok(cache) => cache,
            Err(error) => {
                return TextResponse {
                    text: None,
                    error: Some(format!("cache lock failed: {error}")),
                    error_kind: None,
                    cache_status: None,
                    throttled_count: 0,
                }
            }
        };

        if let Some(entry) = cache.get(&cache_key) {
            if entry.stored_at.elapsed() <= RSS_CACHE_TTL {
                Some(entry.text.clone())
            } else {
                cache.remove(&cache_key);
                None
            }
        } else {
            None
        }
    };
    if let Some(text) = cached_text {
        return TextResponse {
            text: Some(text),
            error: None,
            error_kind: None,
            cache_status: Some("hit".to_string()),
            throttled_count: 0,
        };
    }

    let mut last_error: Option<String> = None;
    let mut last_error_kind: Option<String> = None;
    let mut throttled_count = 0;
    let retry_delays = [Duration::from_millis(0), Duration::from_millis(750), Duration::from_millis(1500), Duration::from_millis(3000)];

    for (index, delay) in retry_delays.iter().enumerate() {
        let attempt = index + 1;
        if !delay.is_zero() {
            sleep(*delay).await;
        }

        let response = client
            .get("https://nyaa.si/")
            .query(&[
                ("page", "rss"),
                ("q", query.as_str()),
                ("c", category.as_str()),
                ("f", filter.as_str()),
                ("p", "1"),
            ])
            .send()
            .await;

        match response {
            Ok(response) => {
                let status = response.status();
                let response = match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        let msg = format!("request failed on attempt {attempt}: {error:#}");
                        if status.as_u16() == 429 {
                            throttled_count += 1;
                            last_error = Some(msg);
                            last_error_kind = Some("throttled".to_string());
                            continue;
                        }
                        last_error = Some(msg);
                        continue;
                    }
                };

                return match response.text().await {
                    Ok(text) => {
                        if let Ok(mut cache) = rss_cache().lock() {
                            cache.insert(
                                cache_key.clone(),
                                CachedRssEntry {
                                    text: text.clone(),
                                    stored_at: Instant::now(),
                                },
                            );
                        }

                        TextResponse {
                            text: Some(text),
                            error: None,
                            error_kind: None,
                            cache_status: Some("miss".to_string()),
                            throttled_count,
                        }
                    }
                    Err(error) => TextResponse {
                        text: None,
                        error: Some(format!("read failed on attempt {attempt}: {error:#}")),
                        error_kind: None,
                        cache_status: Some("miss".to_string()),
                        throttled_count,
                    },
                };
            }
            Err(error) => {
                last_error = Some(format!("request failed on attempt {attempt}: {error:#}"));
            }
        }
    }

    TextResponse {
        text: None,
        error: last_error,
        error_kind: last_error_kind,
        cache_status: Some("miss".to_string()),
        throttled_count,
    }
}

#[tauri::command]
async fn resolve_anilist_titles(name: String) -> TitleResponse {
    let client = match ANILIST_CLIENT.get() {
        Some(client) => client,
        None => {
            let built = match reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()
            {
                Ok(client) => client,
                Err(error) => {
                    return TitleResponse {
                        titles: vec![],
                        error: Some(format!("client build failed: {error:#}")),
                    }
                }
            };
            let _ = ANILIST_CLIENT.set(built);
            ANILIST_CLIENT.get().unwrap()
        }
    };
    let payload = serde_json::json!({
        "query": "query($search: String) { Media(search: $search, type: ANIME) { title { romaji english native } } }",
        "variables": { "search": name }
    });

    let response = match client
        .post("https://graphql.anilist.co")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return TitleResponse {
                titles: vec![],
                error: Some(format!("request failed: {error}")),
            }
        }
    };

    let value: serde_json::Value = match response.json().await {
        Ok(value) => value,
        Err(error) => {
            return TitleResponse {
                titles: vec![],
                error: Some(format!("json failed: {error}")),
            }
        }
    };

    let media = &value["data"]["Media"];
    if media.is_null() {
        return TitleResponse {
            titles: vec![],
            error: None,
        };
    }

    let mut titles = vec![];
    for key in ["romaji", "english", "native"] {
        if let Some(title) = media["title"][key].as_str() {
            titles.push(title.to_string());
        }
    }

    TitleResponse { titles, error: None }
}

#[tauri::command]
fn save_magnet_file(filename_hint: String, content: String) -> Result<SavedFileResponse, String> {
    let path = FileDialog::new()
        .set_file_name(&filename_hint)
        .save_file()
        .ok_or_else(|| "save cancelled".to_string())?;

    fs::write(&path, content).map_err(|error| format!("write failed: {error}"))?;

    Ok(SavedFileResponse {
        path: path.display().to_string(),
    })
}

#[tauri::command]
fn open_target(target: String) -> Result<(), String> {
    if !target.starts_with("magnet:")
        && !target.starts_with("http://")
        && !target.starts_with("https://")
    {
        return Err("blocked: target must use magnet:, http://, or https:// scheme".to_string());
    }

    #[cfg(target_os = "windows")]
    let result = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &target])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&target).spawn();

    result.map(|_| ()).map_err(|error| format!("open failed: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_nyaa_rss,
            resolve_anilist_titles,
            save_magnet_file,
            open_target
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
