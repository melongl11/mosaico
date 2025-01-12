"use strict";
/* global module: false, console: false, __dirname: false, process: false */

var express = require("express");
var upload = require("jquery-file-upload-middleware");
var bodyParser = require("body-parser");
var fs = require("fs");
var _ = require("lodash");
var app = express();
var gmagic = require("gm");
var gm = gmagic.subClass({ imageMagick: true });
var config = require("../server-config.js");
var extend = require("util")._extend;
var url = require("url");
var path = require("path");
var base64Img = require("base64-img-promise");

app.use(require("connect-livereload")({ ignore: [/^\/dl/, /^\/img/] }));
// app.use(require('morgan')('dev'));

app.use(bodyParser.json({ limit: "5mb" }));
app.use(
  bodyParser.urlencoded({
    // to support URL-encoded bodies
    limit: "5mb",
    extended: true
  })
);

// I created a new url because I could not use the same url as the image upload.
app.post("/upload_editted/", function(req, res) {
  var source = path.join(__dirname, "/../.tmp/", ""); // path where the editted image will be temporarily saved
  var imgName = path.join(path.parse(path.basename(url.parse(req.body.imgUrl).pathname)).name.replace('%20', '') + "_edit"); // the original name of image
  var destination = path.join(__dirname, "/../uploads/"); // path where the editted image will be finally saved
  var thumbnailDestinataion = path.join(
    __dirname,
    "/../uploads/",
    "thumbnail/"
  ); // path where the thumbnail of editted image will be finally saved
  var extension = "";
  var newUrl = "";
  var stat = 0;
  // Since the tui image editor uses canvas, the data is transferred in base64 format.
  base64Img
    .img(req.body.imgFile, source, imgName)
    .then(function(result) {
      // convert base64 image to image file.
      newUrl = result; // path where the editted image will be temporarily saved. it include the name of image
      extension = path.parse(newUrl).ext;
      destination = path.join(destination, imgName + extension)
      fs.copyFileSync(newUrl, destination); // copy the image file from temporarily folder to upload folder
    })
    .then(function(result) {
      try {
        fs.unlinkSync(newUrl); // delete the temporarily image file
      } catch (err) {
        console.log(err);
      }
    })
    .then(function(result) {
      stat = fs.statSync(destination)
    })
    .then(function(result) {
      gm(destination) // make thumbnail.
        .resize(90, 90, "^")
        .gravity("center")
        .extent(90, 90)
        .write(path.join(thumbnailDestinataion, imgName + extension), function(err) {
          if (err) console.log(err);
        });
      var url = req.protocol + "://" + req.get("host") + "/uploads/" + imgName + extension;
      res.status(200).json({
        "url": url,
        "thumbnailUrl" : req.protocol + "://" + req.get("host") + "/uploads/thumbnail/" + imgName + extension,
        "name": imgName + extension,
        "size" : stat.size,
        "deleteType": "DELETE",
        "deleteUrl": url,
        "originalName" : imgName + extension,
        "type" : "image/" + extension.replace('.', '')
      });
    })
    .catch(function(err) {
      console.log(err);
      res.status(500).send("error");
    });
});

var listFiles = function(req, options, callback) {
  var files = [];
  var counter = 1;
  var finish = function() {
    if (!--counter) callback(files);
  };

  var uploadHost = req.protocol + "://" + req.get("host");

  fs.readdir(
    options.uploadDir,
    _.bind(function(err, list) {
      _.each(
        list,
        function(name) {
          var stats = fs.statSync(options.uploadDir + "/" + name);
          if (stats.isFile()) {
            var file = {
              name: name,
              url: uploadHost + options.uploadUrl + "/" + name,
              size: stats.size
            };
            _.each(options.imageVersions, function(value, version) {
              counter++;
              fs.exists(
                options.uploadDir + "/" + version + "/" + name,
                function(exists) {
                  if (exists)
                    file.thumbnailUrl =
                      uploadHost +
                      options.uploadUrl +
                      "/" +
                      version +
                      "/" +
                      name;
                  finish();
                }
              );
            });
            files.push(file);
          }
        },
        this
      );
      finish();
    }, this)
  );
};

var uploadOptions = {
  tmpDir: ".tmp",
  uploadDir: "./uploads",
  uploadUrl: "/uploads",
  imageVersions: { thumbnail: { width: 90, height: 90 } }
};

app.get("/upload/", function(req, res) {
  listFiles(req, uploadOptions, function(files) {
    res.json({ files: files });
  });
});

app.use("/upload/", upload.fileHandler(uploadOptions));

// imgProcessorBackend + "?src=" + encodeURIComponent(src) + "&method=" + encodeURIComponent(method) + "&params=" + encodeURIComponent(width + "," + height);
app.get("/img/", function(req, res) {
  var params = req.query.params.split(",");

  if (req.query.method == "placeholder") {
    var out = gm(params[0], params[1], "#707070");
    res.set("Content-Type", "image/png");
    var x = 0,
      y = 0;
    var size = 40;
    // stripes
    while (y < params[1]) {
      out = out
        .fill("#808080")
        .drawPolygon(
          [x, y],
          [x + size, y],
          [x + size * 2, y + size],
          [x + size * 2, y + size * 2]
        )
        .drawPolygon(
          [x, y + size],
          [x + size, y + size * 2],
          [x, y + size * 2]
        );
      x = x + size * 2;
      if (x > params[0]) {
        x = 0;
        y = y + size * 2;
      }
    }
    // text
    out
      .fill("#B0B0B0")
      .fontSize(20)
      .drawText(0, 0, params[0] + " x " + params[1], "center")
      .stream("png")
      .pipe(res);
  } else if (req.query.method == "resize" || req.query.method == "cover") {
    // NOTE: req.query.src is an URL but gm is ok with URLS.
    // We do parse it to localpath to avoid strict "securityPolicy" found in some ImageMagick install to prevent the manipulation
    var urlparsed = url.parse(req.query.src);
    var src = "./" + decodeURI(urlparsed.pathname);
    var ir = gm(src);
    ir.format(function(err, format) {
      if (!err) {
        res.set("Content-Type", "image/" + format.toLowerCase());
        if (req.query.method == "resize") {
          ir.autoOrient()
            .resize(
              params[0] == "null" ? null : params[0],
              params[1] == "null" ? null : params[1]
            )
            .stream()
            .pipe(res);
        } else {
          ir.autoOrient()
            .resize(params[0], params[1] + "^")
            .gravity("Center")
            .extent(params[0], params[1] + ">")
            .stream()
            .pipe(res);
        }
      } else {
        console.error(
          "ImageMagick failed to detect image format for",
          src,
          ". Error:",
          err
        );
        res.status(404).send("Error: " + err);
      }
    });
  }
});

app.post("/dl/", function(req, res) {
  var response = function(source) {
    if (req.body.action == "download") {
      res.setHeader(
        "Content-disposition",
        "attachment; filename=" + req.body.filename
      );
      res.setHeader("Content-type", "text/html");
      res.write(source);
      res.end();
    } else if (req.body.action == "email") {
      var nodemailer = require("nodemailer");
      var transporter = nodemailer.createTransport(config.emailTransport);

      var mailOptions = extend(
        {
          to: req.body.rcpt, // list of receivers
          subject: req.body.subject, // Subject line
          html: source // html body
        },
        config.emailOptions
      );

      transporter.sendMail(mailOptions, function(error, info) {
        if (error) {
          console.log(error);
          res.status(500).send("Error: " + error);
        } else {
          console.log("Message sent: " + info.response);
          res.send("OK: " + info.response);
        }
      });
    }
  };

  response(req.body.html);
});

// This is needed with grunt-express-server (while it was not needed with grunt-express)

var PORT = process.env.PORT || 3000;

app.use("/templates", express.static(__dirname + "/../templates"));
app.use("/uploads", express.static(__dirname + "/../uploads"));
app.use(express.static(__dirname + "/../dist/"));

var server = app.listen(PORT, function() {
  var check = gm(100, 100, "#000000");
  check.format(function(err, format) {
    if (err)
      console.error(
        "ImageMagick failed to run self-check image format detection. Error:",
        err
      );
  });
  console.log("Express server listening on port " + PORT);
});

// module.exports = app;
