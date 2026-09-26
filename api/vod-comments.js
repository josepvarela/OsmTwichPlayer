// Vercel Serverless Function: proxy hacia el chat guardado de un VOD.
//
// IMPORTANTE — por qué se reescribió este archivo:
// La API que se usaba antes (api.twitch.tv/v5/videos/{id}/comments, la
// vieja API "Kraken"/v5) fue apagada por Twitch de forma DEFINITIVA el 28
// de febrero de 2022. No es un problema de configuración ni de CORS: ese
// endpoint ya no existe y siempre va a fallar, sin importar qué mandemos.
// Por eso el chat de los VODs nunca cargaba ("Este video no tiene chat
// guardado...").
//
// La única forma que le queda hoy a un sitio de terceros de traer el chat
// guardado de un VOD es la misma que usa la propia web de Twitch por
// dentro: su API GraphQL interna y no oficial (gql.twitch.tv), con la
// "persisted query" VideoCommentsByOffsetOrCursor. Esto NO es un endpoint
// documentado ni soportado por Twitch — lo usan también herramientas
// conocidas como TwitchDownloader — así que puede cambiar o dejar de
// funcionar sin aviso en cualquier momento; si eso pasa, no hay nada raro
// en nuestro código, es Twitch modificando su API interna otra vez.
//
// Mantenemos la MISMA forma de respuesta que devolvía la v5 vieja
// ({ comments: [...], _next: cursor }) para no tener que tocar el resto
// del frontend que ya sabe leer ese formato.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const { videoId, offset, cursor } = req.query || {};
  if (!videoId) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "missing_video_id" }));
  }

  // Client-Id público que usa la propia web de Twitch (twitch.tv) para sus
  // llamadas GQL sin login. No es un secreto nuestro: es el mismo que
  // cualquiera puede ver en las devtools del navegador en twitch.tv, y es
  // el que usan las herramientas de la comunidad para este mismo fin.
  const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  const PERSISTED_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

  const variables = cursor
    ? { videoID: String(videoId), cursor: String(cursor) }
    : { videoID: String(videoId), contentOffsetSeconds: Math.max(0, Math.floor(Number(offset) || 0)) };

  const body = [
    {
      operationName: "VideoCommentsByOffsetOrCursor",
      variables,
      extensions: { persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH } },
    },
  ];

  try {
    const gqlRes = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!gqlRes.ok) {
      res.statusCode = gqlRes.status;
      return res.end(
        JSON.stringify({ error: "gql_http_error", message: `Twitch GQL respondió ${gqlRes.status}` })
      );
    }

    const gqlData = await gqlRes.json();
    const video = gqlData?.[0]?.data?.video;

    if (gqlData?.[0]?.errors?.length) {
      res.statusCode = 502;
      return res.end(
        JSON.stringify({ error: "gql_error", message: gqlData[0].errors[0]?.message || "Error de Twitch GQL" })
      );
    }

    // video === null: el VOD no tiene chat guardado (o Twitch lo devuelve
    // vacío para ese contenido), no un fallo nuestro.
    if (!video || !video.comments) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ comments: [], _next: null }));
    }

    const edges = video.comments.edges || [];
    const comments = edges.map((edge) => {
      const node = edge.node || {};
      const message = node.message || {};
      const fragments = (message.fragments || []).map((f) => ({
        text: f.text || "",
        emoticon: f.emote ? { emoticon_id: f.emote.emoteID || f.emote.id } : undefined,
      }));
      return {
        content_offset_seconds: node.contentOffsetSeconds || 0,
        commenter: {
          display_name: node.commenter?.displayName || null,
          name: node.commenter?.login || null,
        },
        message: {
          body: fragments.map((f) => f.text).join(""),
          user_color: message.userColor || null,
          user_badges: (message.userBadges || []).map((b) => ({ _id: b.setID })),
          fragments,
        },
      };
    });

    const hasNext = !!video.comments.pageInfo?.hasNextPage;
    const nextCursor = hasNext && edges.length ? edges[edges.length - 1].cursor : null;

    res.statusCode = 200;
    return res.end(JSON.stringify({ comments, _next: nextCursor }));
  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: "network_error", message: String(err) }));
  }
};
