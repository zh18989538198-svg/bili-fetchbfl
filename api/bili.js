import crypto from "node:crypto";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Safari/537.36";

const cache =
  globalThis.__biliMonitorCache ||
  new Map();

globalThis.__biliMonitorCache =
  cache;

const sleep =
  ms => new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );

function headers(uid){
  return {
    "User-Agent":UA,
    "Accept":"application/json, text/plain, */*",
    "Accept-Language":"zh-CN,zh;q=0.9",
    "Referer":
      `https://space.bilibili.com/${uid}/video`
  };
}

async function fetchJson(
  url,
  options={},
  retries=2
){
  let lastErr;

  for (
    let attempt=0;
    attempt<=retries;
    attempt++
  ){
    try{
      const res = await fetch(
        url,
        {
          ...options,
          signal:
            AbortSignal.timeout(
              10000
            )
        }
      );

      const text =
        await res.text();

      if (!res.ok){
        throw new Error(
          `B站 HTTP ${res.status}`
        );
      }

      let json;

      try{
        json =
          JSON.parse(text);
      }catch{
        throw new Error(
          "B站返回了非 JSON 内容，可能触发临时风控"
        );
      }

      if (
        [-352,-412,-509]
          .includes(
            Number(json?.code)
          )
      ){
        throw new Error(
          `B站风控/限流 code=${json.code}`
        );
      }

      return json;

    }catch(err){
      lastErr = err;

      if (
        attempt < retries
      ){
        await sleep(
          350 *
          Math.pow(2, attempt)
        );
      }
    }
  }

  throw lastErr;
}

function normalizeArchive(x){
  return {
    bvid:
      String(
        x?.bvid || ""
      ),

    title:
      String(
        x?.title ||
        "未命名视频"
      ),

    play:
      Number(
        x?.stat?.view ??
        x?.play ??
        0
      ) || 0,

    created:
      Number(
        x?.pubdate ??
        x?.created ??
        x?.ctime ??
        0
      ) || 0
  };
}

/* 通道 A */

async function fetchBySeries(
  uid,
  limit=1000
){
  const ps = 100;
  const out = [];
  let total = null;

  for (
    let pn=1;
    pn<=Math.ceil(limit/ps);
    pn++
  ){
    const url =
      new URL(
        "https://api.bilibili.com/x/series/recArchivesByKeywords"
      );

    url.searchParams.set(
      "mid",
      uid
    );

    url.searchParams.set(
      "keywords",
      ""
    );

    url.searchParams.set(
      "pn",
      String(pn)
    );

    url.searchParams.set(
      "ps",
      String(ps)
    );

    url.searchParams.set(
      "orderby",
      "pubdate"
    );

    const json =
      await fetchJson(
        url,
        {
          headers:
            headers(uid)
        },
        2
      );

    if (
      Number(json?.code) !== 0
    ){
      throw new Error(
        `series 接口失败 code=${json?.code}: ${json?.message || "unknown"}`
      );
    }

    const archives =
      Array.isArray(
        json?.data?.archives
      )
        ? json.data.archives
        : [];

    if (
      total === null
    ){
      total =
        Number(
          json?.data?.page?.total ??
          json?.data?.page?.count ??
          archives.length
        ) ||
        archives.length;
    }

    out.push(
      ...archives
        .map(normalizeArchive)
        .filter(v => v.bvid)
    );

    if (
      !archives.length ||
      archives.length < ps ||
      out.length >= total ||
      out.length >= limit
    ){
      break;
    }

    await sleep(180);
  }

  return {
    videos:
      out.slice(
        0,
        limit
      ),

    total:
      total ??
      out.length,

    truncated:
      (total ?? out.length)
      > limit,

    source:
      "series"
  };
}

/* 通道 B：WBI */

const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,
  15,50,10,31,58,3,45,35,
  27,43,5,49,33,9,42,19,
  29,28,14,39,12,38,41,13,
  37,48,7,16,24,55,40,61,
  26,17,0,1,60,51,30,4,
  22,25,54,21,56,59,6,63,
  57,62,11,36,20,34,44,52
];

function getMixinKey(orig){
  return MIXIN_KEY_ENC_TAB
    .map(
      i => orig[i] || ""
    )
    .join("")
    .slice(0,32);
}

function keyFromUrl(url){
  const last =
    new URL(url)
      .pathname
      .split("/")
      .pop() || "";

  return last
    .split(".")[0];
}

async function getWbiKeys(uid){
  const json =
    await fetchJson(
      "https://api.bilibili.com/x/web-interface/nav",
      {
        headers:
          headers(uid)
      },
      1
    );

  const imgUrl =
    json?.data?.wbi_img?.img_url;

  const subUrl =
    json?.data?.wbi_img?.sub_url;

  if (
    !imgUrl ||
    !subUrl
  ){
    throw new Error(
      "无法取得 WBI key"
    );
  }

  return {
    imgKey:
      keyFromUrl(imgUrl),

    subKey:
      keyFromUrl(subUrl)
  };
}

function signWbi(
  params,
  imgKey,
  subKey
){
  const mixinKey =
    getMixinKey(
      imgKey + subKey
    );

  const signed = {
    ...params,
    wts:
      Math.floor(
        Date.now()/1000
      )
  };

  const query =
    Object.keys(signed)
      .sort()
      .map(key => {
        const value =
          String(signed[key])
            .replace(
              /[!'()*]/g,
              ""
            );

        return (
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
        );
      })
      .join("&");

  const wRid =
    crypto
      .createHash("md5")
      .update(
        query + mixinKey
      )
      .digest("hex");

  return (
    `${query}&w_rid=${wRid}`
  );
}

async function fetchByWbi(
  uid,
  limit=1000
){
  const {
    imgKey,
    subKey
  } =
    await getWbiKeys(uid);

  const ps = 50;
  const out = [];
  let total = null;

  for (
    let pn=1;
    pn<=Math.ceil(limit/ps);
    pn++
  ){
    const query =
      signWbi(
        {
          mid:uid,
          pn,
          ps,
          order:"pubdate",
          tid:0,
          keyword:"",
          platform:"web",
          web_location:"1550101"
        },
        imgKey,
        subKey
      );

    const url =
      `https://api.bilibili.com/x/space/wbi/arc/search?${query}`;

    const json =
      await fetchJson(
        url,
        {
          headers:
            headers(uid)
        },
        2
      );

    if (
      Number(json?.code) !== 0
    ){
      throw new Error(
        `WBI 接口失败 code=${json?.code}: ${json?.message || "unknown"}`
      );
    }

    const list =
      Array.isArray(
        json?.data?.list?.vlist
      )
        ? json.data.list.vlist
        : [];

    if (
      total === null
    ){
      total =
        Number(
          json?.data?.page?.count ??
          list.length
        ) ||
        list.length;
    }

    out.push(
      ...list
        .map(normalizeArchive)
        .filter(v => v.bvid)
    );

    if (
      !list.length ||
      list.length < ps ||
      out.length >= total ||
      out.length >= limit
    ){
      break;
    }

    await sleep(180);
  }

  return {
    videos:
      out.slice(
        0,
        limit
      ),

    total:
      total ??
      out.length,

    truncated:
      (total ?? out.length)
      > limit,

    source:
      "wbi"
  };
}

export default async function handler(
  req,
  res
){
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (
    req.method !== "GET"
  ){
    res.status(405).json({
      ok:false,
      error:"仅支持 GET"
    });

    return;
  }

  const uid =
    String(
      req.query?.uid || ""
    ).trim();

  if (
    !/^\d{1,20}$/.test(uid)
  ){
    res.status(400).json({
      ok:false,
      error:"UID 格式不正确"
    });

    return;
  }

  const now =
    Date.now();

  const cached =
    cache.get(uid);

  if (
    cached &&
    now - cached.time < 45000
  ){
    res.status(200).json({
      ok:true,
      cached:true,
      ...cached.data
    });

    return;
  }

  let firstError = null;

  try{
    const data =
      await fetchBySeries(
        uid,
        1000
      );

    if (
      !data.videos.length
    ){
      throw new Error(
        "未读取到投稿"
      );
    }

    cache.set(
      uid,
      {
        time:now,
        data
      }
    );

    res.status(200).json({
      ok:true,
      cached:false,
      ...data
    });

    return;

  }catch(err){
    firstError = err;
  }

  try{
    const data =
      await fetchByWbi(
        uid,
        1000
      );

    if (
      !data.videos.length
    ){
      throw new Error(
        "未读取到投稿"
      );
    }

    cache.set(
      uid,
      {
        time:now,
        data
      }
    );

    res.status(200).json({
      ok:true,
      cached:false,
      ...data
    });

    return;

  }catch(err){
    res.status(502).json({
      ok:false,
      error:
        "B站当前拒绝了服务器请求或接口发生变化。请稍后再试。"
        +
        ` series=${firstError?.message || "unknown"}; wbi=${err?.message || "unknown"}`
    });
  }
}
