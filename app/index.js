/* Prerequisites
Trakt API App: https://trakt.tv/oauth/applications/new
Radarr API key: https://wiki.servarr.com/radarr/settings#security
Slack Webhook (optional): https://api.slack.com/messaging/webhooks
*/

/*  Docker run command
	docker run -d --name traktarr \
	-v "<host path to app config location>":"/config" \
	-v "<host path to output folder>":"/output" \
	-e traktFriendID="<friends trakt ID>" \
	-e traktClientID="<from Trakt API App>" \
	-e radarrIP="<http://radarr.ip.address>" \
	-e radarrPort="<7878>" \
	-e radarrApiKey="<Radarr API Key>" \
	-e radarrContainerPath="<Container side of Media storage path from Radarr container>" \
	-e radarrHostPath="<Host side of Media storage path from Radarr container>" \
	-e slackWebhookUrl="https://hooks.slack.com/services/RANDOMCHARS" \
	jorgenjanssonlee/traktarr
*/

const axios = require('axios');
const fs = require('fs');
const { resolve } = require('path');
const { stringify } = require('querystring');
const SlackNotify = require('slack-notify');
const slack = SlackNotify(process.env.slackWebhookUrl); // Configure Slack notifications

// Allow for Dev folder mapping if script is running outside docker container
var NODE_ENV = process.env.NODE_ENV;
var configFolder = "/config";
var outputFolder = "/output";
if (NODE_ENV == "Dev") {
	configFolder = process.env.configFolder;
	outputFolder = process.env.outputFolder;
};
const movieHistoryFile = configFolder + "/moviehistory.txt";


//*************
// Check that all mandatory docker/dev environment variables are configured
//*************

if (process.env.traktFriendID
	&& process.env.traktClientID
	&& process.env.radarrIP
	&& process.env.radarrPort
	&& process.env.radarrApiKey
	&& process.env.radarrContainerPath
	&& process.env.radarrHostPath
	&& fs.existsSync(configFolder)
	&& fs.existsSync(outputFolder)
) {
	console.log("All required env variables and volume mappings are present, starting processing " + new Date(new Date() + 3600 * 1000 * 10).toISOString());
	if (process.env.slackWebhookUrl) {
		console.log('Slack notifications enabled');
	};
} else {
	console.log("Error! Environment variables or volume mappings are missing, aborting. Check your docker run command");
	return;
};

//*************
// Start main proccesing flow
//*************

console.log('Getting movie lists');
const main = Promise.all([
	getTraktMovies(),
	getRadarrMovies()
]).then(function (response) {
	// log succesful API results
	let responseStatus = response.map(a => "Status: " + a.status + "  URL: " + a.config.url);
	console.log(JSON.stringify(responseStatus, null, 2));
	// compare movie lists
	return compareResults(response);
}).then(function (movies) {
	return createSymlink(movies); // create symlinks in output folder
}).then(function (result) {
	return sendSlackNotification(result); // send optional slack notification if webhook is provided configured
}).finally(function () {
	console.log("Processing completed " + new Date(new Date() + 3600 * 1000 * 10).toISOString());
}).catch(function (error) {
	// handle error
	console.log('Error in main processing flow:');
	console.log(error);
});

//*************
// Functions
//*************

function getTraktMovies() {
	var response = axios.get('https://api.trakt.tv/users/' + process.env.traktFriendID + '/watchlist/movies', {
		headers: { 'trakt-api-version': '2', 'trakt-api-key': process.env.traktClientID }
	})
	return response;
}

function getRadarrMovies() {
	var response = axios.get(process.env.radarrIP + ':' + process.env.radarrPort + '/api/v3/movie', {
		headers: { 'X-API-Key': process.env.radarrApiKey }
	});
	return response;
}

function compareResults(movieLists) {
	return new Promise((resolve, reject) => {
		console.log("Starting compareResults");
		let movieMatches = []; // array of imdbID and file path for movie matches between trakt and radarr that has not been previously processed
		if (movieLists === undefined) {
			reject(new Error('Error! Movies to compare are missing'));
		} else {
			//get array of previously processed movies to avoid double-processing
			if (!fs.existsSync(movieHistoryFile)) {
				try {
					fs.appendFileSync(movieHistoryFile, "These movies have already been processed and will be ignored" + "\n");
				} catch (err) {
					console.log(`Error creating movieHistoryFile: ${err}`);
					reject(err);
				}
			}
			if (fs.existsSync(movieHistoryFile)) {
				try {
					console.log("movieHistoryFile exists");
					let data = fs.readFileSync(movieHistoryFile);
					let movieHistory = data.toString().split("\n");
					movieHistory.splice(-1, 1);

					// Split movieLists object arrays into the parts we care about, for each system
					let traktMovies = movieLists[0].data;
					let radarrMovies = movieLists[1].data;

					// iterate through items in traktMovies that have not been previously processed and store their imdbIDs
					for (var i = 0; i < traktMovies.length; i++) {
						if (traktMovies[i].movie.ids.imdb != null && !(movieHistory.indexOf(traktMovies[i].movie.ids.imdb) > -1)) {
							// match traktImdbIDs to items in radarrMovies where downloaded = true
							for (var j = 0; j < radarrMovies.length; j++) {
								if (traktMovies[i].movie.ids.imdb == radarrMovies[j].imdbId && radarrMovies[j].hasFile == true) {
									var movieDetails = {};
									movieDetails["imdbId"] = traktMovies[i].movie.ids.imdb;
									movieDetails["folderPath"] = radarrMovies[j].folderName;
									movieDetails["fileName"] = radarrMovies[j].movieFile.relativePath;
									movieMatches.push(movieDetails);
								}
							}
						}
					};
					console.log("Matching movies " + JSON.stringify(movieMatches, null, 2));
					resolve(movieMatches);
				} catch (err) {
					console.log(`Error comparing results: ${err}`);
					reject(err);
				}
			}
		}
	  });
}
	
function createSymlink(movies) {
	return new Promise((resolve, reject) => {
	// create symlink in output folder with volume mapping substitution
	// then add imdb of movie to history log to prevent re-processing
	let completedSymlinks = "";
	for (var i = 0; i < movies.length; i++) {
		try {
			// calculate path to movie specific output folder, matching name of the movie file's parent folder
			var lastFolder = movies[i].folderPath.split('/').pop(); 
			var destFolder = outputFolder + "/" + lastFolder; 

			// Remap path to source folder from hosts perspective, without docker volume mappings
			var remappedSourceFolder = movies[i].folderPath.replace( process.env.radarrContainerPath, process.env.radarrHostPath.replace(/\/$/, '') );
			
			// Create symlink
			fs.symlinkSync(remappedSourceFolder, destFolder, 'dir');
			console.log("symlink created in: " + destFolder);
			console.log("with target: " + remappedSourceFolder);
			completedSymlinks += destFolder + "\n";
			fs.appendFileSync(movieHistoryFile, movies[i].imdbId + "\n"); // log processed movies to file
		} catch (err) {
			console.log(`Error creating SymLinks: ${err}`);
			reject(err);
		}
	}
	resolve(completedSymlinks);
})
}

function sendSlackNotification(completedSymlinks) {
	return new Promise((resolve, reject) => {
	if (process.env.slackWebhookUrl) {
		let notificationMessage = "";
		if (completedSymlinks == "") {
			notificationMessage = "Traktarr complete, no movies to process";
		} else {
			notificationMessage = "Traktarr complete. Symlinks created: \n" + completedSymlinks;
		};
		slack.send(notificationMessage)
			.then(() => {
				console.log('Sent Slack notification');
				resolve();
			}).catch((err) => {
				console.error(`Slack send error: ${err}`);
				reject(err);
			});
	};
})
}