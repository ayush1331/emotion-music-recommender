# Emotion Music Recommender

## Overview
The Emotion Music Recommender is a web application that detects the user's facial emotions in real-time using webcam input and recommends mood-based songs through the Spotify API. The application provides a fun and interactive way to discover music that matches your current emotional state.

## Features
- Real-time emotion detection using face-api.js
- Mood-based song recommendations from Spotify
- Live webcam feed with detected emotion display
- Responsive design for both mobile and desktop
- Minimal dark theme for a modern look
- Automatic refresh of song recommendations based on detected emotions

## Technologies Used
- **HTML**: For the structure of the web application.
- **CSS**: For styling the application with a minimal dark theme.
- **JavaScript**: For the main logic, including emotion detection and Spotify API integration.
- **face-api.js**: For real-time facial emotion detection.
- **Spotify Web API**: For fetching mood-based song recommendations.

## Setup Instructions
1. Clone the repository:
   ```
   git clone <repository-url>
   cd Emotion-Music-Recommender
   ```

2. Open the `public/index.html` file in a web server environment (e.g., using `http-server`):
   ```
   npx http-server public
   ```

3. Obtain your Spotify API credentials (Client ID and Client Secret) and replace the placeholders in `public/app.js`.

4. Open your browser and navigate to `http://localhost:8080` (or the port provided by your server).

## Usage
- Allow webcam access when prompted.
- The application will start detecting your facial emotions.
- Based on the detected emotion, the application will recommend songs from Spotify.
- Click on the play button to listen to song previews or open them in Spotify.

## Future Enhancements
- Implement local model storage for offline usage.
- Add more emotions and corresponding playlists.
- Enhance the UI with additional animations and features.

## License
This project is licensed under the MIT License.