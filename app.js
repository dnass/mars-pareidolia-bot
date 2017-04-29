const Tbb = require('twitter-bot-bot');
const fs = require('fs');
const fsp = require('fs-promise');
const jsdiff = require('diff');
const request = require('request-promise-native');
const exec = require('child_process')
  .execFileSync;
const _ = require('lodash');

const dataPath = `${__dirname}/data.json`;

const bot = new Tbb(run);

function getData() {
  return readOrMakeFile()
    .then(function (data) {
      const fileData = JSON.parse(data);
      const botData = {
        pastSols: fileData.pastSols,
        queue: fileData.queue
      }
      if (botData.queue.length < 25) {
        bot.log(`short queue (${botData.queue.length}) – finding new faces`);
        botData.rover = _.sample(['curiosity', 'opportunity', 'spirit']);
        bot.log(`picked rover ${botData.rover}`);
        return getSol(botData)
          .then(function (maxSol) {
            const sols = _.reject(_.range(maxSol + 1), function (item) {
              return botData.pastSols[botData.rover].indexOf(item) > -1;
            })
            botData.thisSol = _.sample(sols);
            botData.pastSols[botData.rover].push(botData.thisSol);
            return botData;
          })
          .then(getSolData)
          .then(getImages)
          .then(function (results) {
            bot.log(`adding ${results.length} images to queue`);
            results.forEach(function (result) {
              result.rover = botData.rover;
              result.sol = botData.thisSol;
            });
            botData.queue = botData.queue.concat(results);
            return botData;
          })
          .then(writeFile)
          .then(getData)
      } else
        return botData;
    })
}

function getSol(botData) {
  bot.log(`getting max sol for ${botData.rover}`);
  const url = `https://api.nasa.gov/mars-photos/api/v1/rovers/${botData.rover}/photos?sol=1&page=1&api_key=${bot.params.NASA_API_KEY}`;
  return request.get(url)
    .then(function (response) {
      const data = JSON.parse(response);
      return data.photos[0].rover.max_sol;
    });
}

function getSolData(botData) {
  bot.log(`accessing nasa data for sol ${botData.thisSol}`);
  const url = `https://api.nasa.gov/mars-photos/api/v1/rovers/${botData.rover}/photos?sol=${botData.thisSol}&api_key=${bot.params.NASA_API_KEY}`;
  return request.get(url)
    .then(function (response) {
      bot.log('parsing data')
      const data = JSON.parse(response);
      let cameras = ['FHAZ', 'RHAZ'];
      if (botData.rover == 'Spirit')
        cameras += ['MAST', 'NAVCAM'];
      else
        cameras += ['NAVCAM', 'PANCAM'];
      const images = _.reject(data.photos, function (image) {
        return cameras.indexOf(image.camera.name) == -1;
      });
      bot.log(`found ${images.length} images`);
      return images.map(function (image, ndx) {
        return {
          url: image.img_src,
          camera: image.camera.name
        }
      });
    })
}

function getImages(images) {
  const classifiers = ['haarcascade_frontalface_alt.xml', 'haarcascade_frontalface_alt2.xml', 'haarcascade_frontalface_default.xml'];
  const results = [];
  bot.log('searching for faces in ' + images.length + ' images')
  images.forEach(function (image, ndx) {
    const no = ndx + 1;
    bot.log(`searching image ${no} of ${images.length}`)
    const result = exec('python', [__dirname + '/detect.py', image.url, classifiers.join(','), __dirname], {}, function (err, stdout, stderr) {
      if (err) throw new Error(err)
      return stdout.toString();
    })
    const parsedResult = JSON.parse(result);
    if (parsedResult) {
      bot.log(`${parsedResult.faceCount} faces found in image ${no} with ${parsedResult.classifier}`);
      parsedResult.camera = image.camera;
      parsedResult.dateAcquired = new Date()
        .toString();
      if (results.length) {
        const minDiff = results.map(function (result) {
            return jsdiff.diffChars(result.filepath, parsedResult.filepath)
              .reduce(function (acc, d) {
                if (d.added || d.removed)
                  acc += parseInt(d.count);
                return acc;
              }, 0);
          })
          .reduce(function (acc, val) {
            return Math.min(acc, val);
          });
        if (minDiff < 9) {
          fs.unlink(parsedResult.filepath);
          bot.log(`image ${no} rejected: too similar`);
          return '';
        }
      }
      bot.log(`image ${no} accepted`);
      results.push(parsedResult);
    } else
    bot.log(`image ${no} rejected: no faces found`);
  });
  return results;
}

function postTweet(botData) {
  if (botData.queue.length) {
    bot.log('selecting tweet from queue')
    botData.thisTweet = botData.queue.splice(Math.floor(Math.random() * botData.queue.length), 1)[0];
    bot.log(botData.thisTweet.filepath);
    return fsp.readFile(botData.thisTweet.filepath, { encoding: 'base64' })
    .then(image => {
      const altText = `${botData.thisTweet.faceCount} faces seen on ${botData.thisTweet.sol}`;
      const tweetText = `${capitalize(botData.thisTweet.rover)}, sol ${botData.thisTweet.sol}`;
      return bot.tweet({
        media: image,
        altText: altText,
        status: tweetText
      })
    }).then(tweetData => {
      botData.tweetData = tweetData;
      return botData;
    })
  } else {
    bot.log('queue empty');
    return botData;
  }
}

function readOrMakeFile() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dataPath)) {
      bot.log('creating data file');
      const initFile = {
        "pastSols": {
          "curiosity": [],
          "spirit": [],
          "opportunity": []
        },
        "queue": []
      };
      fs.writeFileSync(dataPath, JSON.stringify(initFile));
    }
    resolve()
  }).then(() => {
    bot.log('reading data');
    return fsp.readFile(dataPath, 'utf-8');
  })
}

function writeFile(botData) {
  bot.log('writing data');
  const output = {
    pastSols: botData.pastSols,
    queue: botData.queue
  }
  const json = JSON.stringify(output);
  return fsp.writeFile(dataPath, json, 'utf8')
    .then(function () {
      return botData;
    });
}

function cleanup(botData) {
  if (botData.thisTweet) {
    return fsp.unlink(botData.thisTweet.filepath)
      .then(function () {
        return botData.tweetData;
      })
  } else
    return 'no tweet tweeted';
}

function capitalize(string) {
  return string.charAt(0)
    .toUpperCase() + string.slice(1);
}

function run() {
  return getData()
    .then(postTweet)
    .then(writeFile)
    .then(cleanup)
}

module.exports = bot
