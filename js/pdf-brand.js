/**
 * Shared Your Institution duck mark for PDF headers.
 * Uses assets/institution-mark.svg (white sticker outline on green/navy bars).
 */
(function (global) {
  "use strict";

  var MASCOT_PATH = "assets/institution-mark.svg";
  var MASCOT_ASPECT = 1667 / 2020;
  var logoPromise = null;

  function isBackgroundPixel(data, idx) {
    var i = idx * 4;
    return data[i + 3] < 24 || (data[i] < 24 && data[i + 1] < 24 && data[i + 2] < 24);
  }

  function knockoutCornerBackground(imageData) {
    var w = imageData.width;
    var h = imageData.height;
    var data = imageData.data;
    var seen = new Uint8Array(w * h);
    var stack = [0, w - 1, (h - 1) * w, h * w - 1];
    var s;
    for (s = 0; s < stack.length; s++) seen[stack[s]] = 1;
    while (stack.length) {
      var p = stack.pop();
      if (!isBackgroundPixel(data, p)) continue;
      data[p * 4 + 3] = 0;
      var x = p % w;
      var y = (p / w) | 0;
      var next = [];
      if (x > 0) next.push(p - 1);
      if (x + 1 < w) next.push(p + 1);
      if (y > 0) next.push(p - w);
      if (y + 1 < h) next.push(p + w);
      for (s = 0; s < next.length; s++) {
        if (!seen[next[s]]) {
          seen[next[s]] = 1;
          stack.push(next[s]);
        }
      }
    }
  }

  function loadDuckLogo() {
    if (logoPromise) return logoPromise;
    logoPromise = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var h = 280;
          var w = Math.round(h * (img.naturalWidth / img.naturalHeight));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          var imageData = ctx.getImageData(0, 0, w, h);
          knockoutCornerBackground(imageData);
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = MASCOT_PATH;
    });
    return logoPromise;
  }

  function duckWidth(height) {
    return height * MASCOT_ASPECT;
  }

  function drawDuck(doc, dataUrl, x, y, height) {
    if (!dataUrl || !doc || typeof doc.addImage !== "function") return 0;
    var width = duckWidth(height);
    try {
      doc.addImage(dataUrl, "PNG", x, y, width, height);
      return width;
    } catch (err) {
      return 0;
    }
  }

  global.FacultyDashboardPdfBrand = {
    loadDuckLogo: loadDuckLogo,
    drawDuck: drawDuck,
    duckWidth: duckWidth
  };
})(window);
