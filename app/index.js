/* Prerequisites
Trakt API App: https://trakt.tv/oauth/applications/new
Radarr API key: https://wiki.servarr.com/radarr/settings#security
Sonarr API key: https://wiki.servarr.com/sonarr/settings#security
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
	-e sonarrIP="<http://sonarr.ip.address>" \
	-e sonarrPort="<7878>" \
	-e sonarrApiKey="<sonarr API Key>" \
	-e sonarrContainerPath="<Container side of Media storage path from sonarr container>" \
	-e sonarrHostPath="<Host side of Media storage path from sonarr container>" \
	-e slackWebhookUrl="https://hooks.slack.com/services/RANDOMCHARS" \
	jorgenjanssonlee/traktarr
*/

const axios = require('axios');
const { log } = require('console');
const fs = require('fs');
const { resolve } = require('path');
const { stringify } = require('querystring');
const SlackNotify = require('slack-notify');
const slack = SlackNotify(process.env.slackWebhookUrl); // Configure Slack notifications

// Allow for Dev folder mapping if script is running outside docker container
const NODE_ENV = process.env.NODE_ENV;
var configFolder = "/config";
var outputFolder = "/output";
if (NODE_ENV == "Dev") {
	configFolder = process.env.configFolder;
	outputFolder = process.env.outputFolder;
};

// Hardcode history tracking file into app config folder
const traktarrHistoryFile = configFolder + "/traktarrHistory.txt";

// Check that all mandatory docker/dev environment variables are configured
const configResults = checkConfig();

// Set up calls only for services that are completely configured (enabled)
const promises = [];

if(configResults["radarrConfig"] == "Complete") {
	const traktMoviesPromise = getTraktMovies().then(res => ({ res: res, promise: 'traktMovies' }));
	promises.push(traktMoviesPromise);
	const radarrMoviesPromise = getRadarrMovies().then(res => ({ res: res, promise: 'radarrMovies' }));
	promises.push(radarrMoviesPromise);
 };

 if(configResults["sonarrConfig"] == "Complete") {
	const traktShowsPromise = getTraktShows().then(res => ({ res: res, promise: 'traktShows' }));
	promises.push(traktShowsPromise);
	const sonarrShowsPromise = getSonarrShows().then(res => ({ res: res, promise: 'sonarrShows' }));
	promises.push(sonarrShowsPromise);
 };


//*************
// Start main proccesing flow
//*************

console.log('Traktarr starting main flow ' + new Date(new Date() + 3600 * 1000 * 10).toISOString());
const main = Promise.all(promises
).then(function (response) {
	// log succesful API results
	let responseStatus = response.map(a => a.promise + " status: " + a.res.status + ", URL: " + a.res.config.url);
	console.log(JSON.stringify(responseStatus, null, 2));
	// compare all lists
	return compareLists(response);
}).then(function (matches) {
	return createFolderSymlink(matches); // create symlinks in output folder
}).then(function (result) {
	return sendSlackNotification(result); // send optional slack notification if webhook is provided configured
}).finally(function () {
	console.log("Traktarr processing completed " + new Date(new Date() + 3600 * 1000 * 10).toISOString());
}).catch(function (error) {
	// handle error
	console.log('Traktarr, Error in main processing flow:');
	console.log(error);
});



//*************
// Functions
//*************

function checkConfig() {
	let confResults = {};

	// check required trakt and app config
	if (process.env.traktFriendID
		&& process.env.traktClientID
		&& fs.existsSync(configFolder)
		&& fs.existsSync(outputFolder)
	) {
		confResults["traktConfig"] = "Complete";
		console.log("Trakt and app config complete");
	} else {
		confResults["traktConfig"] = "Incomplete";
		console.log("Error! Trakt environment variables or volume mappings are missing, aborting. Check your docker run command");
		return;
	};

	// check radarr config
	if (process.env.radarrIP
		&& process.env.radarrPort
		&& process.env.radarrApiKey
		&& process.env.radarrContainerPath
		&& process.env.radarrHostPath
	) {
		confResults["radarrConfig"] = "Complete";
		console.log("Radarr config complete. Radarr processing enabled");
	} else {
		confResults["radarrConfig"] = "Incomplete";
		console.log("Radarr config incomplete. Radarr processing disabled");
	};

	// check sonarr config
	if (process.env.sonarrIP
		&& process.env.sonarrPort
		&& process.env.sonarrApiKey
		&& process.env.sonarrContainerPath
		&& process.env.sonarrHostPath
	) {
		confResults["sonarrConfig"] = "Complete";
		console.log("Sonarr config complete. Sonarr processing enabled");
	} else {
		confResults["sonarrConfig"] = "Incomplete";
		console.log("Sonarr config incomplete. Sonarr processing disabled");
	};

	//console.log("confResults: " + JSON.stringify(confResults));
	return confResults;
} 


function getTraktMovies() {
	var response = axios.get('https://api.trakt.tv/users/' + process.env.traktFriendID + '/watchlist/movies', {
		headers: { 'trakt-api-version': '2', 'trakt-api-key': process.env.traktClientID }
	})
	return response;
}

function getTraktShows() {
	var response = axios.get('https://api.trakt.tv/users/' + process.env.traktFriendID + '/watchlist/shows', {
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

function getSonarrShows() {
	var response = axios.get(process.env.sonarrIP + ':' + process.env.sonarrPort + '/api/v3/series', {
		headers: { 'X-API-Key': process.env.sonarrApiKey }
	});
	return response;
}

function compareLists(lists) {
	return new Promise((resolve, reject) => {
		console.log("Traktarr, starting compareLists");
		let movieMatches = []; // array of imdbID, folder and file path for movie matches between trakt and radarr that has not been previously processed
		let showMatches = []; // array of imdbID, folder path and show title for show matches between trakt and sonarr that has not been previously processed
		if (lists === undefined) {
			reject(new Error('Traktarr error! Lists to compare are missing'));
		} else {
			//get array of previously processed movies to avoid double-processing
			if (!fs.existsSync(traktarrHistoryFile)) {
				try {
					fs.appendFileSync(traktarrHistoryFile, "Traktarr, these movies have already been processed and will be ignored" + "\n");
				} catch (err) {
					console.log(`Traktar error creating traktarrHistoryFile: ${err}`);
					reject(err);
				}
			}
			if (fs.existsSync(traktarrHistoryFile)) {
				try {
					console.log("Traktarr, traktarrHistoryFile exists");
					let data = fs.readFileSync(traktarrHistoryFile);
					let itemHistory = data.toString().split("\n");
					itemHistory.splice(-1, 1);

					var traktMovies = [];
					var radarrMovies = [];
					var traktShows = [];
					var sonarrShows = [];

					for (let i = 0; i < lists.length; i++) {
						switch (lists[i].promise) {
							case "traktMovies":
								traktMovies = lists[i].res.data;
								// console.log("traktMovies: " + JSON.stringify(traktMovies));
								break;
							case "radarrMovies":
								radarrMovies = lists[i].res.data;
								// console.log("radarrMovies: " + JSON.stringify(radarrMovies));
								break;
							case "traktShows":
								traktShows = lists[i].res.data;
								// console.log("traktShows: " + JSON.stringify(traktShows));
								break;
							case "sonarrShows":
								sonarrShows = lists[i].res.data;
								// console.log("sonarrShows: " + JSON.stringify(sonarrShows));
								break;
						}
					};
					
					//*************
					// MOVIES
					//*************
					// iterate through items in traktMovies that have not been previously processed and store their imdbIDs
					if (traktMovies.length > 0 && radarrMovies.length > 0) {
						for (let i = 0; i < traktMovies.length; i++) {
							if (traktMovies[i].movie.ids.imdb !== null && !(itemHistory.indexOf(traktMovies[i].movie.ids.imdb) > -1)) {
								// match traktImdbIDs to items in radarrMovies where downloaded = true
								for (let j = 0; j < radarrMovies.length; j++) {
									if (traktMovies[i].movie.ids.imdb == radarrMovies[j].imdbId && radarrMovies[j].hasFile == true) {
										let movieDetails = {};
										movieDetails["imdbId"] = traktMovies[i].movie.ids.imdb;
										movieDetails["folderPath"] = radarrMovies[j].folderName;
										movieDetails["fileName"] = radarrMovies[j].movieFile.relativePath;
										movieMatches.push(movieDetails);
									}
								}
							}
						}
					};

					//*************
					// TV Shows
					//*************
					// iterate through items in traktShows that have not been previously processed and store their imdbIDs
					if (traktShows.length > 0 && sonarrShows.length > 0) {
						for (var i = 0; i < traktShows.length; i++) {
							if (traktShows[i].show.ids.imdb !== null && !(itemHistory.indexOf(traktShows[i].show.ids.imdb) > -1)) {
								// match traktImdbIDs to items in sonarrShows where show has at least on epsisode file on disk
								for (var j = 0; j < sonarrShows.length; j++) {
									if (traktShows[i].show.ids.imdb == sonarrShows[j].imdbId && sonarrShows[j].statistics.episodeFileCount > 0) {
										let showDetails = {};
										showDetails["imdbId"] = traktShows[i].show.ids.imdb;
										showDetails["folderPath"] = sonarrShows[j].path;
										showDetails["title"] = sonarrShows[j].title;
										showMatches.push(showDetails);
									}
								}
							}
						}
					};

					let matches = [];
					matches.push(movieMatches)
					matches.push(showMatches)
					resolve(matches);

				} catch (err) {
					console.log(`Traktarr error comparing lists: ${err}`);
					reject(err);
				}
			}
		}
	  });
}
	
function createFolderSymlink(matches) {
	let movies = matches[0];  
	let shows= matches[1];
	return new Promise((resolve, reject) => {
	// create symlink in output folder with volume mapping substitution
	// then add imdb of movie to history log to prevent re-processing
	let completedSymlinks = "";
	// Split matches object arrays into the parts we care about, for each type

	// process Movies
	if (movies.length > 0) { 
		for (let i = 0; i < movies.length; i++) {
			try {
				// calculate path to movie specific output folder, matching name of the movie file's parent folder
				var lastFolder = movies[i].folderPath.split('/').pop(); 
				var destFolder = outputFolder + "/" + lastFolder; 

				// Remap path to source folder from hosts perspective, without docker volume mappings
				var remappedSourceFolder = movies[i].folderPath.replace( process.env.radarrContainerPath, process.env.radarrHostPath.replace(/\/$/, '') );
				
				// Create symlink
				fs.symlinkSync(remappedSourceFolder, destFolder, 'dir');
				console.log("Traktarr Movie folder symlink created in: " + destFolder);
				console.log("with target: " + remappedSourceFolder);
				completedSymlinks += destFolder + "\n";
				fs.appendFileSync(traktarrHistoryFile, movies[i].imdbId + "\n"); // log processed movies to file
			} catch (err) {
				console.log(`Traktarr error creating Movie folder symLinks: ${err}`);
				reject(err);
			}
		}
	};

	// Process TV Shows
	if (shows.length > 0) {
		for (let i = 0; i < shows.length; i++) {
			try {
				// calculate path to movie specific output folder, matching name of the movie file's parent folder
				var lastFolder = shows[i].folderPath.split('/').pop(); 
				var destFolder = outputFolder + "/" + lastFolder; 

				// Remap path to source folder from hosts perspective, without docker volume mappings
				var remappedSourceFolder = shows[i].folderPath.replace( process.env.sonarrContainerPath, process.env.sonarrHostPath.replace(/\/$/, '') );
				
				// Create symlink
				fs.symlinkSync(remappedSourceFolder, destFolder, 'dir');
				console.log("Traktarr TV Show folder symlink created in: " + destFolder);
				console.log("with target: " + remappedSourceFolder);
				completedSymlinks += destFolder + "\n";
				fs.appendFileSync(traktarrHistoryFile, shows[i].imdbId + "\n"); // log processed show to file
			} catch (err) {
				console.log(`Traktarr error creating TV Shows folder symLinks: ${err}`);
				reject(err);
			}
		}
	};

	resolve(completedSymlinks);
})
}

function sendSlackNotification(completedSymlinks) {
	return new Promise((resolve, reject) => {
	if (process.env.slackWebhookUrl) {
		let notificationMessage = "";
		if (completedSymlinks == "") {
			notificationMessage = "Traktarr complete, nothing to process";
		} else {
			notificationMessage = "Traktarr complete. Symlinks created: \n" + completedSymlinks;
		};
		slack.send(notificationMessage)
			.then(() => {
				console.log('Traktarr sent Slack notification');
				resolve();
			}).catch((err) => {
				console.error(`Slack send error: ${err}`);
				reject(err);
			});
	};
})
}