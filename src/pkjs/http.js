// Small HTTP helpers for PebbleKit JS (XMLHttpRequest only, no fetch/FormData).

// callback(err, body, status). On HTTP errors, err.status and err.body are set.
function request(method, url, options, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  var headers = options.headers || {};
  Object.keys(headers).forEach(function (name) {
    xhr.setRequestHeader(name, headers[name]);
  });
  xhr.timeout = 60000;
  xhr.onload = function () {
    var body = null;
    try {
      body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
    } catch (e) {
      body = { message: xhr.responseText };
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      callback(null, body, xhr.status);
    } else {
      var err = new Error((body && (body.message || body.error)) || ('HTTP ' + xhr.status));
      err.status = xhr.status;
      err.body = body;
      callback(err, body, xhr.status);
    }
  };
  xhr.onerror = function () {
    callback(new Error('No internet connection?'));
  };
  xhr.ontimeout = function () {
    callback(new Error('The server did not answer in time.'));
  };
  xhr.send(options.body || null);
}

function formEncode(fields) {
  return Object.keys(fields).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
  }).join('&');
}

// Builds a multipart/form-data body by hand; file.content is a string.
function multipart(fields, file) {
  var boundary = '----PebbleWorkout' + Date.now().toString(16);
  var parts = Object.keys(fields).map(function (name) {
    return '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' +
      fields[name] + '\r\n';
  });
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' +
    file.name + '"\r\nContent-Type: application/xml\r\n\r\n' + file.content + '\r\n');
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: parts.join('') + '--' + boundary + '--\r\n'
  };
}

// UTF-8 safe base64 (btoa is not available in every PebbleKit JS runtime).
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(text) {
  var bytes = unescape(encodeURIComponent(text));
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes.charCodeAt(i);
    var b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : NaN;
    var c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : NaN;
    out += B64.charAt(a >> 2) +
      B64.charAt(((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)) +
      (isNaN(b) ? '=' : B64.charAt(((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6))) +
      (isNaN(c) ? '=' : B64.charAt(c & 63));
  }
  return out;
}

module.exports = { request: request, formEncode: formEncode, multipart: multipart, base64: base64 };
