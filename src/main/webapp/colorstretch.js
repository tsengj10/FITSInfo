/*
 * colorstretch - utilities to stretch colormap of LSST images
 *
 * Summary of usage:
 * (assumes 18-bit encoded RGB)
 *
 * const context = document.getElementById("myCanvas").getContext("2d");
 * const imgData = context.getImageData(0, 0, context.canvas.width,
 *                                            context.canvas.height);
 * const pxl = imgData.data;
 * // create histogram fro calculating auto-stretch
 * const hist = ColorStretch.filter.accumulate(pxl, ColorStretch.decoders.raw);
 * // create a stretcher function to map pixel value to RGB
 * const stretch = hist.makeStretcher(ColorStretch.colormaps.saoA);
 * // apply stretcher to pixel array
 * ColorStretch.filter.apply(pxl, ColorStretch.decoders.raw, stretch);
 * // put pixel array back into canvas
 * context.putImage(imgData, 0, 0);
 *
 */

var ColorStretch = {};

(function($) {

//=================================================================
// decoders:  functions which map rgba to scalar
//=================================================================
  $.decoders = {};

  //---------------------------------------------------------------
  // raw 18-bit pixel values encoded in RGB fields
  //---------------------------------------------------------------
  $.decoders.raw = function(r, g, b, a) {
    return (r << 10) | (g << 2) | (b >> 6) | 0;
  }

  //---------------------------------------------------------------
  // 24-bit pixel values encoded in RGB fields
  // (probably used if FITS file used floats)
  //---------------------------------------------------------------
  $.decoders.int24 = function(r, g, b, a) {
    return (r << 16) | (g << 8) | b | 0;
  }

//=================================================================
// colormaps:  functions which map scalar 0..1 to rgba.
// Giving these functions a value < 0 returns the underflow array.
// A value >= 1 returns the overflow array.
//=================================================================
  $.colormaps = {};

  //---------------------------------------------------------------
  // set these as values to return for underflow and overflow
  //---------------------------------------------------------------
  $.colormaps.underflow = [ 0, 0, 0, 0 ];
  $.colormaps.overflow = [ 255, 255, 255, 255 ];

  //---------------------------------------------------------------
  // utility function to linearly interpolate between fixed points
  //   x = input argument
  //   points = array of fixed points in x.  points[0] should be 0.
  //     range 0..1
  //   values = array of values at the corresponding fixed points.
  //     range 0..1
  // return value:  scalar function value, max 255
  //---------------------------------------------------------------
  $.colormaps.interpolate = function(x, points, values) {
    for (let i = 0; i < points.length; i++) {
      if (x < points[i]) {
        let v = values[i-1] + (values[i] - values[i-1]) *
                (x - points[i-1]) / (points[i] - points[i-1]);
        let vv = (256 * v) | 0;
        return vv > 255 ? 255 : vv;
      }
    }
    // overflow
    return (values[values.length - 1]) | 0;
  }

  //---------------------------------------------------------------
  // specific colormaps
  //---------------------------------------------------------------

  $.colormaps.gray = function(x) {
    if (x < 0.0) return $.colormaps.underflow;
    if (x >= 1.0) return $.colormaps.overflow;
    const v = (256 * x) | 0;
    return [v, v, v, 255];
  };

  $.colormaps.saoA = function(x) {
    if (x < 0.0) return $.colormaps.underflow;
    else if (x < 1.0)
      return [ $.colormaps.interpolate(x, [0, 0.25, 0.5, 1],
                                          [0,    0,   1, 1]),
               $.colormaps.interpolate(x, [0, 0.25, 0.5, 0.75, 1],
                                          [0,    1,   0,    0, 1]),
               $.colormaps.interpolate(x, [0, 0.125, 0.5, 0.75, 1],
                                          [0,     0,   1,    0, 0]),
               255 ];
    else return $.colormaps.overflow;
  };

  $.colormaps.saoB = function(x) {
    if (x < 0.0) return $.colormaps.underflow;
    else if (x < 1.0)
      return [ $.colormaps.interpolate(x, [0, 0.25,  0.5, 1],
                                          [0,    0,    1, 1]),
               $.colormaps.interpolate(x, [0,  0.5, 0.75, 1],
                                          [0,    0,    1, 1]),
               $.colormaps.interpolate(x, [0, 0.25, 0.5, 0.75, 1],
                                          [0,    1,   0,    0, 1]),
               255 ];
    else return $.colormaps.overflow;
  };

  $.colormaps.saoBB = function(x) {
    if (x < 0.0) return $.colormaps.underflow;
    else if (x < 1.0)
      return [ $.colormaps.interpolate(x, [0, 0.5, 1],
                                          [0,   1, 1]),
               $.colormaps.interpolate(x, [0, 0.25, 0.75, 1],
                                          [0,    0,    1, 1]),
               $.colormaps.interpolate(x, [0, 0.5, 1],
                                          [0,   0, 1]),
               255 ];
    else return $.colormaps.overflow;
  };

  $.colormaps.standard = function(x) {
    if (x < 0.0) return $.colormaps.underflow;
    else if (x < 1.0)
      return [ $.colormaps.interpolate(x, [0, 0.333, 0.333, 0.666, 0.666, 1],
                                          [0, 0.3  , 0    , 0.3  , 0.3  , 1]),
               $.colormaps.interpolate(x, [0, 0.333, 0.333, 0.666, 0.666, 1],
                                          [0, 0.3  , 0.3  , 1.0  , 0    , 0.3]),
               $.colormaps.interpolate(x, [0, 0.333, 0.333, 0.666, 0.666, 1],
                                          [0, 1.0  , 0.0  , 0.3  , 0    , 0.3]),
               255 ];
    else return $.colormaps.overflow;
  };

  //===============================================================
  // axis tic utilities
  //   w = width to subdivide
  //   ndiv = target number of divisions
  //===============================================================
  $.axes = {};

  //-------------------------------------------------------------
  // truncate a value (usually a width) to a specified granularity
  //   w = value to truncate
  //   ndiv = target number of divisions
  // return value:  the truncated value
  //-------------------------------------------------------------
  $.axes.truncate = function(w, ndiv) {
    let n = w / ndiv; // initial bin width
    let tens = 1;
    while (n < 1) {
      n *= 10;
      tens /= 10;
    }
    while (n > 10) {
      n /= 10;
      tens *= 10;
    }
    n = (n | 0);
    if (n > 5) n = 5;
    else if (n > 2) n = 2;
    return n*tens;
  };

  //-------------------------------------------------------------
  // figure out how many tics there should be
  // based on how many digits in x width.
  // This should also work for xlo and xhi < 1.
  // return:  array of values for the tics
  //-------------------------------------------------------------
  $.axes.tics = function(xlo, xhi, ndiv) {
    const w = $.axes.truncate(xhi - xlo, 5);
    let v = [];
    for (let x = Math.ceil(xlo / w) * w; x < xhi; x += w) v.push(x);
    return v;
  };

  //-------------------------------------------------------------
  // figure out how many tics there should be,
  // with logarithmic spacing.
  // return:  array of values for the tics.
  //-------------------------------------------------------------
  $.axes.logtics = function(xlo, xhi) {
    // find largest power of 10 < xlo
    let x = xlo;
    let tens = 1;
    while (x < 0.99) {
      x *= 10;
      tens /= 10;
    }
    while (x > 10) {
      x /= 10;
      tens *= 10;
    }
    let v = [];
    for (let y = tens; y < xhi; y *= 10) v.push(y);
    return v;
  };

  //===============================================================
  // colormap histogram
  //   1. histogram counts the number of pixels with a certain
  //      pixel value.
  //   2. one can then generate a stretcher function which maps
  //      a pixel value to rgba.
  //   3. the histogram and colorbar can also be drawn.
  //
  // The horizontal axis of the histogram is the pixel value,
  // and the vertical axis the number of pixels with that value.
  //
  // Note some limitations:  we assume x >= 0 (no negative pixels
  // values), and that bin contents are also non-negative.
  //===============================================================

  //---------------------------------------------------------------
  // constructor
  //   bins = 1D array of binned data (assumes equal-spaced bins)
  //   xlo = left edge of binned data
  //   xhi = right edge of binned data
  //---------------------------------------------------------------
  $.Histogram = function(bins, xlo, xhi) {
    this.data = bins;
    this.xlo = xlo;
    this.xhi = xhi;

    // counters for associated stretcher function application
    this.underflows = 0;
    this.overflows = 0;
    this.valids = 0;
  }

  $.Histogram.prototype = {

    //-------------------------------------------------------------
    // queries
    //-------------------------------------------------------------

    // number of bins in histogram object
    nbins: function() { return this.data.length; },

    // test whether histogram is usable
    valid: function() { return this.data.length > 0; },
 
    // maximum bin contents
    // (assumes bin contents are non-zero)
    yhi: function() {
      let ym = -1;
      for (let i = 0; i < this.data.length; i++) {
        if (this.data[i] > ym) ym = this.data[i];
      }
      return ym;
    },

    // bin width
    dx: function() { return (this.xhi - this.xlo) / this.data.length; },

    // number of entries
    sum: function() {
      let s = 0;
      for (let i = 0; i < this.data.length; i++) s += this.data[i];
      return s;
    },

    // low edge of x bin, given index
    xLowEdge: function(index) { return this.xlo + index * this.dx(); },

    // bin index to x conversion (same as xLowEdge)
    bin2x: function(index) { return this.xLowEdge(index); },

    // x to bin index conversion
    x2bin: function(x) { return ((x - this.xlo) / this.dx()) | 0; },

    //-------------------------------------------------------------
    // fill histogram
    //   x = (number or array of numbers) values to fill
    // return value:  the histogram object
    //-------------------------------------------------------------
    fill: function(x) {
      const rd = this.data.length / (this.xhi - this.xlo);
      if (x instanceof Array) {
        for (let j = 0; j < x.length; j++) {
          if (x[j] >= this.xlo && x[j] < this.xhi) {
            const i = ((x[j]-this.xlo) * rd) | 0;
            this.data[i] += 1;
          }
        }
      } else {
        if (x >= this.xlo && x < this.xhi) {
          const i = ((x-this.xlo) * rd)|0;
          this.data[i] += 1;
        }
      }
      return this;
    },

    //-------------------------------------------------------------
    // add another histogram to this one
    //-------------------------------------------------------------
    add: function(hist) {
      if (this.data.length != hist.data.length ||
          this.xlo != hist.xlo ||
          this.xhi != hist.xhi) return null; // histograms don't match
      for (let i = 0; i < this.data.length; i++) this.data[i] += hist.data[i];
      return this;
    },

    //-------------------------------------------------------------
    // reset the histogram to zero
    //-------------------------------------------------------------
    reset: function() {
      for (let i = 0; i < this.data.length; i++) this.data[i] = 0;
      return this;
    },

    //-------------------------------------------------------------
    // clear counters
    //-------------------------------------------------------------
    clearCounters: function() {
      this.underflows = 0;
      this.overflows = 0;
      this.valids = 0;
      return this;
    },

    //-------------------------------------------------------------
    // figure out how many tics there should be
    // based on how many digits in x width.
    // return:  array of x values for the tics
    //-------------------------------------------------------------
    getXTics: function() { return $.axes.tics(this.xlo, this.xhi, 5); },

    //-------------------------------------------------------------
    // figure out how many tics there should be in y.
    // assume the bottom of the histogram is 0.
    // return:  array of y values for the tics
    //-------------------------------------------------------------
    getYTics: function() { return $.axes.tics(0, this.yhi(), 5); },

    //-------------------------------------------------------------
    // figure out how many tics there should be in y,
    // with logarithmic spacing.
    // assume the bottom corresponds to y=1.
    // return:  array of y values for the tics.
    //-------------------------------------------------------------
    getLogYTics: function() { return $.axes.logtics(1, this.yhi()); },

    //-------------------------------------------------------------
    // rebin so that the new histogram has the maximum bins specified.
    // Since rebinning will only combine integer multiples,
    // the final histogram may have fewer bins than the maximum.
    //-------------------------------------------------------------
    rebin: function(maxbins) {
      if (maxbins >= this.nbins()) {
        // don't modify if histogram bins already fit within maximum
        return this;
      } else {
        const factor = Math.ceil(this.nbins() / maxbins);
        const nb = Math.ceil(this.nbins() / factor); // new xhi >= old xhi
        const olddx = this.dx();
        const ndata = new Array(nb);
        const xwidth = Math.round(factor * olddx * nb);
        let j = 0;
        let k = 0;
        ndata[0] = 0;
        for (let i = 0; i < this.nbins(); i++) {
          ndata[j] += this.data[i];
          if (++k == factor) {
            k = 0;
            j += 1;
            ndata[j] = 0;
          }
        }
        nh = new $.Histogram(ndata, this.xlo, this.xlo + xwidth)
        return nh;
      }
    },

    //-------------------------------------------------------------
    // return low edge of first bin with contents
    //   xstart = starting pixel value
    //-------------------------------------------------------------
    getXMinFilled: function(xstart=0) {
      let i = this.x2bin(xstart);
      if (i < 0) i = 0;
      while (i < this.data.length && this.data[i] == 0) i += 1;
      return this.bin2x(i);
    },

    //-------------------------------------------------------------
    // return low edge of last bin with zero contents
    //-------------------------------------------------------------
    getXMaxFilled: function() {
      let i = this.data.length - 1;
      while (i >= 0 && this.data[i] == 0) i -= 1;
      return this.bin2x(i + 1);
    },

    //-------------------------------------------------------------
    // return [low,high] indices of non-zero contents.
    // this.data[low] and this.data[high] will both be non-zero.
    //   xstart = starting x value
    //   xstop = stopping x value, exclusive (upper edge of bin)
    //-------------------------------------------------------------
    getRange: function(xstart=0, xstop=-1) {
      let ilo = this.x2bin(xstart);
      if (ilo < 0) ilo = 0;
      let ihi = (xstop < 0) ? this.x2bin(this.xhi + xstop) : this.x2bin(xstop);
      if (ihi > this.data.length) ihi = this.data.length;
      if (ihi <= ilo) return null;

      while (this.data[ilo] == 0 && ilo < this.data.length) ilo += 1;
      if (ilo == this.data.length || ihi < ilo) return null;
      while (this.data[ihi] == 0) ihi -= 1; // don't need bound check
      ihi += 1; // exclusive upper end
      return [ this.bin2x(ilo), this.bin2x(ihi) ];
    },

    //-------------------------------------------------------------
    // return a new histogram with empty bins removed above and below.
    // xlo and xhi are adjusted accordingly.
    //   xstart = starting pixel value for trimming low side
    //     if xstart <= xlo, it will start at the lowest bin.
    //   xstop = starting pixel value for trimming high side.
    //     if xstop < 0, it will be relative to end.
    //-------------------------------------------------------------
    trim: function(xstart=0, xstop=-1) {
      let x0 = (xstart == null) ? 0 : xstart;
      let x1 = (xstop == null) ? -1 : xstop;
      const d = this.dx();
      let ilo = ((x0 - this.xlo) / d) | 0;
      if (ilo < 0) ilo = 0;
      let ihi = ((x1 - this.xlo) / d) | 0;
      if (xstop < 0) ihi = ((this.xhi + x1 - this.xlo) / d) | 0;
      while (this.data[ilo] == 0 && ilo < this.data.length) ilo += 1;
      if (ilo == this.data.length || ihi < ilo) {
        // empty histogram
        return new $.Histogram([], this.xlo, this.xhi);
      }
      while (this.data[ihi] == 0) ihi -= 1; // don't need bound check here
      ihi += 1; // exclusive upper end
      const ndata = new Array(ihi - ilo);
      for (let i = ilo; i < ihi; i++) ndata[i-ilo] = this.data[i];
      return new $.Histogram(ndata, this.xlo + ilo*d, this.xlo + ihi*d);
    },

    //-------------------------------------------------------------
    // return a stretcher function derived from the cdf.
    // The stretcher function maps 0..1 to an RGBA quadruplet.
    //
    // This should work for dx > 1, but usually the stretcher
    // will operate on histograms with dx=1.  Rebinning is
    // usually for display purposes, not for actual color-mapping.
    //
    // By default, the stretcher will use the range 0 up to
    // the maximum pixel value.  Optionally, one can specify
    // minimum and maximum pixel values.
    //-------------------------------------------------------------
    makeStretcher: function(colormap, xstart=0, xstop=-1) {
      const sh = this.trim(xstart, xstop); // trim zero bins off sides
      console.log('makeStretcher xlo = ' + sh.xlo + ', xhi = ' + sh.xhi);
      return (function(hist, cm) {
        let sum = 0;
        let a = new Array(hist.nbins());
        for (let i = 0; i < hist.nbins(); i++) {
          sum += hist.data[i];
          a[i] = sum;
        }
        const range = sum + 1; // compress cdf to range 0..1
        let rm = new Array(hist.nbins());
        let gm = new Array(hist.nbins());
        let bm = new Array(hist.nbins());
        for (let i = 0; i < hist.nbins(); i++) {
          let v = cm(a[i] / range);
          rm[i] = v[0];
          gm[i] = v[1];
          bm[i] = v[2];
        }
        a = null; // dispose
        return function(v) {
          if (v < hist.xlo) {
            return $.colormaps.underflow;
          }
          if (v >= hist.xhi) {
            return $.colormaps.overflow;
          }
          const i = ((v - hist.xlo) / hist.dx()) | 0;
          return [ rm[i], gm[i], bm[i], 255 ];
        }
      })(sh, colormap);
    },

    resetStretcher: function() {
      this.underflows = 0;
      this.overflows = 0;
      this.valids = 0;
    }
  };

  //===============================================================
  // histogram renderer
  //===============================================================

  //---------------------------------------------------------------
  // constructor
  //   hist = Histogram object (will be trimmed and rebinned to fit canvas)
  //   width = total width in pixels of the canvas to paint
  //   height = total height in pixels of the canvas to paint
  //   margin = fraction of width and height to devote to left
  //            and bottom margins
  //   barHeight = fraction of height to devote to colorbar
  //
  // After construction, can change the following parameters:
  //   font = font for axis labels, default "10px Arial"
  //   strokeStyle = stroke style, default "black"
  //   lineWidth = line width in pixels, default 1
  //   barSpacer = pixel space between histogram and bar (default 2)
  //   logy = true if vertical axis in log scale, false if linear
  //---------------------------------------------------------------
  $.Renderer = function(hist, width, height, margin, barHeight) {
    this.width = width; // total width (margin + hist)
    this.height = height; // total height (hist + bar + margin)
    this.margin = margin; // portion of canvas width to reserve on left/bottom
    this.barHeight = barHeight; // portion of height to reserve for colorbar

    // style settings which can be modified before drawing
    this.font = "10px Arial";
    this.strokeStyle = "black";
    this.lineWidth = 1;

    // renderer style settings
    this.barSpacer = 2; // two pixel spacer between histogram and bar
    this.logy = true;

    // dimensions of parts
    this.histw = (1.0 - margin) * width | 0;
    this.histh = (((1.0 - margin - barHeight) * height) | 0) - this.barSpacer;
    this.xbase = width - this.histw;

    this.hist = hist.trim().rebin(this.histw); // trim and rebin for rendering
  }

  $.Renderer.prototype = {

    //-------------------------------------------------------------
    // draw horizontal colorbar
    //   pxl = image data array
    //   width = width in pixels of pxl
    //   height = height in pixels of pxl
    //   stretcher = function (scalar -> rgba)
    //-------------------------------------------------------------
    horizontalBar: function(pxl, width, height, stretcher) {
      const n = Math.min(width, this.hist.nbins());
      const d = this.hist.dx();
      for (let i = 0; i < n; i++) {
        const v = i * d + this.hist.xlo;
        const c = stretcher(v);
        const p = i * 4;
        pxl[p] = c[0];
        pxl[p+1] = c[1];
        pxl[p+2] = c[2];
        pxl[p+3] = c[3];
      }
      for (let j = 1; j < height; j++) {
        const p = j * width * 4;
        for (let i = 0; i < 4*n; i++) pxl[p+i] = pxl[i];
      }
      // draw color traces in order or r, g, and b
      // (stretching seems to make this less useful)
      for (let i = 0; i < n; i++) {
        const p = i * 4;
        const r = pxl[p];
        const g = pxl[p+1];
        const b = pxl[p+2];
        let y = height - (r * height / 256) | 0;
        let base = 4 * width * y;
        pxl[base+p] = 255;
        pxl[base+p+1] = 0;
        pxl[base+p+2] = 0;
        pxl[base+p+3] = 255;
        y = height - (g * height / 256) | 0;
        base = 4 * width * y;
        pxl[base+p] = 0;
        pxl[base+p+1] = 255;
        pxl[base+p+2] = 0;
        pxl[base+p+3] = 255;
        y = height - (b * height / 256) | 0;
        base = 4 * width * y;
        pxl[base+p] = 0;
        pxl[base+p+1] = 0;
        pxl[base+p+2] = 255;
        pxl[base+p+3] = 255;
      }
    },

    //-------------------------------------------------------------
    // draw histogram
    //   pxl = image data array
    //   width = width in pixels of pxl
    //   height = height in pixels of pxl
    //   stretcher = function (scalar -> rgba)
    //-------------------------------------------------------------
    histogram: function(pxl, width, height, stretcher) {
      const n = Math.min(width, this.hist.nbins());
      const d = this.hist.dx();
      let yhi = this.hist.yhi();
      if (this.logy) yhi = Math.log(yhi);
      for (let i = 0; i < n; i++) {
        let y = this.hist.data[i];
        if (y == 0) continue;
        if (this.logy) y = Math.log(y);
        y = ((y / yhi) * height) | 0;
        let v = i * d + this.hist.xlo;
        for (let p = ((height-y)*width+i)*4; p < 4*width*height; p += 4*width) {
          let c = stretcher(v);
          pxl[p] = c[0];
          pxl[p+1] = c[1];
          pxl[p+2] = c[2];
          pxl[p+3] = c[3];
        }
      }
    },

    //-------------------------------------------------------------
    // return horizontal canvas position in pixels
    //   x = pixel value, which over span of histogram
    //       should lie between xlo and xhi.
    //-------------------------------------------------------------
    getXCoordinate: function(x) {
      return (((x - this.hist.xlo) / this.hist.dx()) + this.xbase) | 0;
      //return ((x - this.hist.xlo) * this.histw /
      //        (this.hist.xhi - this.hist.xlo) | 0) +
      //       this.xbase;
    },

    //-------------------------------------------------------------
    // return the pixel value given the horizontal position in canvas
    //   xc = horizontal position in pixels in canvas
    // return value:  pixel value, between xlo and xhi.
    //-------------------------------------------------------------
    getXPosition: function(xc) {
      return this.hist.xlo + (xc - this.xbase) * this.hist.dx();
    },

    //-------------------------------------------------------------
    // return the vertical position in pixels, assuming 0 is top
    //   y = count of pixels with a particular pixel value.
    //-------------------------------------------------------------
    getYCoordinate: function(y) {
      const yh = this.hist.yhi();
      return (yh - y) * this.histh / yh | 0;
    },

    //-------------------------------------------------------------
    // return the vertical position in pixels of log(y)
    //-------------------------------------------------------------
    getLogYCoordinate: function(y) {
      const maxly = Math.log(this.hist.yhi());
      const ly = Math.log(y);
      return (maxly - ly) * this.histh / maxly | 0;
    },

    //-------------------------------------------------------------
    // get contents of the bin at the pixel location
    //   xc = horizontal position in pixels in canvas
    // rendering assumes one visual pixel column corresponds to one bin,
    // which may have dx > 1.
    //-------------------------------------------------------------
    getContents: function(xc) {
      const i = xc - this.xbase; // one pixel column per bin
      if (i < 0 || i >= this.hist.nbins()) return 0;
      else return this.hist.data[i];
    },

    //-------------------------------------------------------------
    // horizontal axis (no line - assume colorbar serves as line)
    //-------------------------------------------------------------
    horizontalAxis: function(context, xtics, ytop, ybottom) {
      context.textAlign = "center";
      context.textBaseline = "hanging";
      for (let i = 0; i < xtics.length; i++) {
        const v = xtics[i]; // pixel value (x axis)
        const x = this.getXCoordinate(v); // location on canvas
        context.beginPath();
        context.moveTo(x, ytop);
        context.lineTo(x, ybottom);
        context.stroke();
        context.fillText("" + v, x, ybottom);
      }
    },

    //-------------------------------------------------------------
    // vertical axis
    //-------------------------------------------------------------
    verticalAxis: function(context, ytics, ycoord, xleft, xright) {
      context.textAlign = "right";
      for (let i = 0; i < ytics.length; i++) {
        const v = ytics[i]; // count value
        const y = ycoord[i]; // location on canvas
        context.beginPath();
        context.moveTo(xleft, y);
        context.lineTo(xright, y);
        context.stroke();
        context.fillText("" + v, xleft, y);
      }
    },

    //-------------------------------------------------------------
    // draw a decorated histogram and colorbar on the canvas
    //-------------------------------------------------------------
    draw: function(context, stretcher) {
      context.font = this.font;
      context.strokeStyle = this.strokeStyle;
      context.lineWidth = this.lineWidth;

      let img = context.createImageData(this.histw, this.histh);
      for (let i = 0; i < img.data.length; i++) img.data[i] = 0;
      this.histogram(img.data, this.histw, this.histh, stretcher);
      context.putImageData(img, this.xbase, 0);

      // height of colorbar in pixels
      const barh = (this.barHeight * this.height - this.barSpacer) | 0;
      if (this.barHeight > 0) {
        let cbimg = context.createImageData(this.histw, barh);
        this.horizontalBar(cbimg.data, this.histw, barh, stretcher);
        context.putImageData(cbimg, this.xbase, this.histh + this.barSpacer);
      }

      // horizontal axis (assume colorbar serves as line)
      const xtics = this.hist.getXTics();
      const xtl = ((this.height - this.histh - barh - this.barSpacer) / 3) | 0;
      this.horizontalAxis(context, xtics,
                          this.histh + barh + this.barSpacer,
                          this.histh + barh + this.barSpacer + xtl);

      // vertical axis:  linear or log
      let ytics = null;
      let ycoord = null;
      if (this.logy) {
        ytics = this.hist.getLogYTics();
        ycoord = new Array(ytics.length);
        for (let i = 0; i < ytics.length; i++) {
          ycoord[i] = this.getLogYCoordinate(ytics[i]);
        }
      } else {
        ytics = this.hist.getYTics();
        ycoord = new Array(ytics.length);
        for (let i = 0; i < ytics.length; i++) {
          ycoord[i] = this.getYCoordinate(ytics[i]);
        }
      }
      this.verticalAxis(context, ytics, ycoord,
                        (0.9 * this.margin * this.width) | 0,
                        (this.margin * this.width) | 0);

    },

    //-------------------------------------------------------------
    // return information based on x position in histogram
    //   x = horizontal pixel location within canvas
    //-------------------------------------------------------------
    info: function(x) {
      const v = this.getXPosition(x);
      if (v < this.xlo || v >= this.xhi) return { valid: false }
      return {
        valid: true,
        value: v,
        counts: this.getContents(x) // contents of bin (after rebinning)
      };
    }

  };

  //===============================================================
  // stretches:  functions which map pixel value -> rgba
  //
  // The functions return a function which
  // can be used by a filter to apply to pixel values.
  //===============================================================
  $.stretches = {};

  //---------------------------------------------------------------
  // generic stretch function, which takes a pixel value
  // and returns rgba
  //---------------------------------------------------------------
  $.stretches.generic = function(stretcher, colormap) {
    return function(v) { return colormap(stretcher(v)); }
  }

  //---------------------------------------------------------------
  // shortcut for histogram-based auto-stretch.
  // If you want access to the histogram or colorbar,
  // then use the $.Histogram class directly.
  //---------------------------------------------------------------
  $.stretches.histogram = function(bins, xlo, xhi, colormap) {
    const hist = new $.Histogram(bins, xlo, xhi).trim();
    return hist.makeStretcher(colormap);
  }

  //===============================================================
  // patch - a rectangle which keeps a histogram and stretcher
  //   x, y, width, height, degrees: similar to Rect,
  //     but conventionally in viewport coordinates so
  //     that one can test whether it contains points
  //     located in viewport space.
  //===============================================================

  class Patch extends OpenSeadragon.Rect {

    //-------------------------------------------------------------
    // same constructor as Rect
    //-------------------------------------------------------------
    constructor(x, y, width, height, degrees) {
      super(x, y, width, height, degrees);
      const asize = (1 << 18);
      this.bins = new Array(asize);
      this.reset();
    }

    //-------------------------------------------------------------
    // invalidate histogram and stretcher,
    // but leave the geometry unchanged.
    //-------------------------------------------------------------
    reset() {
      for (let i = 0; i < this.bins.length; i++) this.bins[i] = 0;
      this.hist = null;
      this.stretcher = null;
      this.level = 0;
    }

    //-------------------------------------------------------------
    // reset just the stretcher, but leave histogram unchanged.
    //-------------------------------------------------------------
    resetStretcher() {
      this.stretcher = null;
    }

    //-------------------------------------------------------------
    // check whether the stretcher function exists
    //-------------------------------------------------------------
    hasStretcher() {
      return (this.stretcher != null);
    }

    //-------------------------------------------------------------
    // get the stretcher function.
    // Return the previous one if it exists.
    // Arguments are needed only if the stretcher
    // needs to be recreated using new image data.
    //-------------------------------------------------------------
    getStretcher(level, cmap, minv, maxv, imageData, decoder) {
      if (this.stretcher) {
        return this.stretcher;
      }
      if (level == null) return null;
      console.log('new stretcher level = ' + level);
      if (!this.hist || level > this.level) {
        this.level = level;
        if (imageData != null && decoder != null) {
          this.hist = new ColorStretch.Histogram(this.bins, 0,
                                                 this.bins.length);
          ColorStretch.filter.fill(this.hist, imageData, decoder);
          console.log('new stretcher histogram, min = '
                      + this.hist.getXMinFilled() + ', max = '
                      + this.hist.getXMaxFilled());
        } else {
          return null;
        }
      }
      const h = this.hist.trim(1);
      if (!h.valid()) return null;
      this.stretcher = h.makeStretcher(cmap, minv, maxv);
      return this.stretcher;
    }
  }

  //===============================================================
  // quilt geometry - a collection of rectangles
  //===============================================================

  $.Quilt = function() {
    this.patches = []; // array of Patch objects
  }

  $.Quilt.prototype = {

    reset: function() {
      for (p of this.patches) p.reset();
    },

    resetStretchers: function() {
      for (p of this.patches) p.resetStretcher();
    },

    // chop up pixelmap into patches
    rezone: function(context, tile, tiledImage, apply) {
      const width = context.canvas.width;
      const height = context.canvas.height;
      const imgData = context.getImageData(0, 0, width, height);
      const pxl = imgData.data;

      let isRowEmpty = function(irow) {
        const w = 4 * width;
        let p = irow * w;
        for (let i = 0; i < width; i++) {
          if (pxl[p] != 0 || pxl[p+1] != 0 || pxl[p+2] != 0) return false;
          p += 4;
        }
        return true;
      };

      let isColumnEmpty = function(icol) {
        const w = 4 * width;
        let p = 4 * icol;
        for (let i = 0; i < height; i++) {
          if (pxl[p] != 0 || pxl[p+1] != 0 || pxl[p+2] != 0) return false;
          p += w;
        }
        return true;
      };

      // divide image into xy zones
      let ystart = [];
      let ywidth = [];
      for (let iy = 0; iy < height; iy++) {
        if (isRowEmpty(iy)) {
          if (ystart.length != ywidth.length) {
            ywidth.push(iy - ystart[ystart.length-1]);
          }
        } else {
          if (ystart.length == ywidth.length) ystart.push(iy);
        }
      }
      if (ystart.length != ywidth.length) {
        ywidth.push(height - ystart[ystart.length-1]);
      }
      let xstart = [];
      let xwidth = [];
      for (let ix = 0; ix < width; ix++) {
        if (isColumnEmpty(ix)) {
          if (xstart.length != xwidth.length) {
            xwidth.push(ix - xstart[xstart.length-1]);
          }
        } else {
          if (xstart.length == xwidth.length) xstart.push(ix);
        }
      }
      if (xstart.length != xwidth.length) {
        xwidth.push(width - xstart[xstart.length-1]);
      }

      // convert to viewport coordinates if tile and tiledImage provided
      let xv = new Array(xstart.length);
      let xw = new Array(xwidth.length);
      let yv = new Array(ystart.length);
      let yw = new Array(ywidth.length);
      if (tile && tiledImage) {
        const bs = tiledImage.getBounds();//image bounds in viewport coordinates
        const bt = tile.bounds; // tile bounds normalized to TiledImage
        const bs0 = bs.getTopLeft();
        const bt0 = bt.getTopLeft();
        for (let i = 0; i < xstart.length; i++) {
          xw[i] = xwidth[i] * bs.width * bt.width / width;
          xv[i] = (xstart[i]*bt.width/width + bt0.x)*bs.width + bs0.x;
        }
        for (let i = 0; i < ystart.length; i++) {
          yw[i] = ywidth[i] * bs.width * bt.width / width;
          yv[i] = (ystart[i]*bt.width/width + bt0.y)*bs.width + bs0.y;
        }
      }
      
      // check if patches already exist
      for (let iy = 0; iy < yv.length; iy++) {
        const cy = yv[iy] + 0.5 * yw[iy];
        for (let ix = 0; ix < xv.length; ix++) {
          const cx = xv[ix] + 0.5 * xw[ix];
          let patch = null;
          for (let p of this.patches) {
            const dx = cx - p.x;
            if (dx >= 0.0 && dx <= p.width) {
              const dy = cy - p.y;
              if (dy >= 0.0 && dy <= p.height) {
                patch = p;
                break;
              }
            }
          }
          if (patch == null) {
            patch = new Patch(xv[ix], yv[iy], xw[ix], yw[iy], 0);
            this.patches.push(patch);
          }

          // get and apply stretcher (need extra arguments)
          const idat = context.getImageData(xstart[ix], ystart[iy],
                                            xwidth[ix], ywidth[iy]);
          apply(patch, idat);
          context.putImageData(idat, xstart[ix], ystart[iy]);
        }
      }
    }

  };

  //===============================================================
  // filter utilities
  //===============================================================
  $.filter = {};

  //---------------------------------------------------------------
  // apply the decoder and stretcher to all the pixels
  //   pxl = pixel array, as from context.getImageData(...).data
  //   decoder = function rgba -> scalar pixel value
  //   stretcher = function scalar pixel value -> rgba
  //---------------------------------------------------------------
  $.filter.apply = function(pxl, decoder, stretcher) {
    let minv = (1 << 18);
    let maxv = 0;
    for (let i = 0; i < pxl.length; i += 4) {
      let v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
      if (v > maxv) maxv = v;
      if (v < minv) minv = v;
      let c = stretcher(v);
      pxl[i] = c[0];
      pxl[i+1] = c[1];
      pxl[i+2] = c[2];
      pxl[i+3] = c[3];
    }
    console.log('applied min = ' + minv + ', max = ' + maxv);
  };

  //---------------------------------------------------------------
  // apply the decoder and stretcher to a rectangle of pixels
  //   pxl = pixel array, as from context.getImageData(...).data
  //   pwidth = width in pixels of pxl
  //   xstart, ystart = coordinates of top left corner
  //   xwidth, ywidth = width in pixels of rectangle
  //   decoder = function rgba -> scalar pixel value
  //   stretcher = function scalar pixel value -> rgba
  //---------------------------------------------------------------
  $.filter.applyToRect = function(pxl, pwidth,
                                  xstart, ystart, xwidth, ywidth,
                                  decoder, stretcher) {
    const rw = 4 * pwidth;
    let p = ystart * rw + xstart * 4;
    for (let iy = ystart; iy < ystart + ywidth; iy++) {
      let i = p;
      for (let ix = 0; ix < xwidth; ix++) {
        let v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
        let c = stretcher(v);
        pxl[i] = c[0];
        pxl[i+1] = c[1];
        pxl[i+2] = c[2];
        pxl[i+3] = c[3];
        i += 4;
      }
      p += rw;
    }
  };

  //---------------------------------------------------------------
  // fill a histogram based on given pixels
  //   hist = existing Histogram
  //   pxl = pixel array, as from context.getImageData(...).data
  //   decoder = function rgba -> scalar pixel value
  //---------------------------------------------------------------
  $.filter.fill = function(hist, pxl, decoder) {
    for (let i = 0; i < pxl.length; i += 4) {
      let v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
      hist.fill(v);
    }
    return hist;
  };

  //---------------------------------------------------------------
  // fill a histogram based on pixels in a given rectangle
  //   hist = existing Histogram
  //   pxl = pixel array, as from context.getImageData(...).data
  //   pwidth = width in pixels of pxl
  //   xstart, ystart = coordinates of top left corner
  //   xwidth, ywidth = width in pixels of rectangle
  //   decoder = function rgba -> scalar pixel value
  //---------------------------------------------------------------
  $.filter.fillFromRect = function(hist, pxl, pwidth,
                                   xstart, ystart, xwidth, ywidth, decoder) {
    const rw = 4 * pwidth;
    let p = ystart * rw + xstart * 4;
    for (let iy = ystart; iy < ystart + ywidth; iy++) {
      let i = p;
      for (let ix = 0; ix < xwidth; ix++) {
        let v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
        hist.fill(v);
        i += 4;
      }
      p += rw;
    }
    return hist;
  };

  //---------------------------------------------------------------
  // make a histogram based on given pixels
  //   pxl = pixel array, as from context.getImageData(...).data
  //   decoder = function rgba -> scalar pixel value
  //---------------------------------------------------------------
  $.filter.accumulate = function(pxl, decoder) {
    let xmin = 1 << 18;
    let xmax = 0;
    let counts = new Array(1 << 18);
    for (let i = 0; i < counts.length; i++) counts[i] = 0;
    for (let i = 0; i < pxl.length; i += 4) {
      let v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
      counts[v] += 1;
      if (v > xmax) xmax = v;
      if (v < xmin) xmin = v;
    }
    let bins = new Array(xmax - xmin + 1);
    let j = 0;
    for (let i = xmin; i <= xmax; i++) bins[j++] = counts[i];
    let hist = new ColorStretch.Histogram(bins, xmin, xmax+1);
    return hist;
  };

  //---------------------------------------------------------------
  // make a histogram based on given pixels, range [xlo,xhi)
  //---------------------------------------------------------------
  $.filter.accumulateWithRange = function(pxl, decoder, xlo, xhi) {
    let xmin = 1 << 18;
    let xmax = 0;
    let counts = new Array(xhi);
    for (let i = 0; i < counts.length; i++) counts[i] = 0;
    for (let i = 0; i < pxl.length; i += 4) {
      const v = decoder(pxl[i], pxl[i+1], pxl[i+2], pxl[i+3]);
      if (v < xlo || v >= xhi) continue;
      counts[v] += 1;
      if (v > xmax) xmax = v;
      if (v < xmin) xmin = v;
    }
    let bins = new Array(xmax - xmin + 1);
    let j = 0;
    for (let i = xmin; i <= xmax; i++) bins[j++] = counts[i];
    let hist = new ColorStretch.Histogram(bins, xmin, xmax+1);
    return hist;
  };

  //---------------------------------------------------------------
  // make a histogram based on pixels
  //     which are above threshold,
  //     and are not adjacent to below-threshold pixels
  //   pxl = pixel array, as from context.getImageData(...).data
  //   decoder = function rgba -> scalar pixel value
  //   pwidth = width in pixels of pxl array
  //   threshold = minimum pixel value to accept
  //---------------------------------------------------------------
  $.filter.accumulateWithThreshold = function(pxl, decoder, pwidth, threshold) {
    let xmin = 1 << 18;
    let xmax = 0;
    let counts = new Array(1 << 18);
    for (let i = 0; i < counts.length; i++) counts[i] = 0;

    // buffer three rows
    let v = [ new Array(pwidth), new Array(pwidth), new Array(pwidth) ];
    for (let i = 0; i < pwidth; i++) v[0][i] = 1 << 18; // out of bounds
    const decodeRow = function(vs, ps, base, w) {
      let j = 0;
      for (let i = base; i < base + 4*w; i += 4) {
        vs[j++] = decoder(ps[i], ps[i+1], ps[i+2], ps[i+3]);
      }
      return v;
    }
    decodeRow(v[1], pxl, 0, pwidth);
    decodeRow(v[2], pxl, 4*pwidth, pwidth);
    v0 = v[0]; // moving row references
    v1 = v[1];
    v2 = v[2];

    const pheight = pxl.length / pwidth;
    for (let irow = 0; irow < pheight; irow++) {
      for (let i = 0; i < pwidth; i++) {
        if (v1[i] < threshold) continue;
        if (v0[i] < threshold || v2[i] < threshold) continue;
        if (i > 0) {
          if (v0[i-1] < threshold || v1[i-1] < threshold || v2[i-1] < threshold)
            continue;
        } else if (i < pwidth - 1) {
          if (v0[i+1] < threshold || v1[i+1] < threshold || v2[i+1] < threshold)
            continue;
        }
        // pixel passes all thresholds
        const vi = v1[i];
        counts[vi] += 1;
        if (vi > xmax) xmax = vi;
        if (vi < xmin) xmin = vi;
      }
      // update rows
      let va = v0; // will overwrite this row
      v0 = v1;
      v1 = v2;
      if (irow == pheight - 1) { // last row - fill next row with 1<<18
        for (let i = 0; i < pwidth; i++) va[i] = 1 << 18;
      } else {
        decodeRow(va, pxl, 4*pwidth*(irow+1), pwidth);
      }
      v2 = va;
    }
    let bins = new Array(xmax - xmin + 1);
    let j = 0;
    for (let i = xmin; i <= xmax; i++) bins[j++] = counts[i];
    let hist = new ColorStretch.Histogram(bins, xmin, xmax+1);
    return hist;
  };

})(ColorStretch);

