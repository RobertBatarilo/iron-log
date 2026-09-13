/// <reference path="../pb_data/types.d.ts" />

// Push-Benachrichtigungen fuer: neues Box-WOD veroeffentlicht, neue Umfrage
// im Social-Feed, neuer Kommentar auf den eigenen Post.
// require() bewusst INNERHALB jedes Handlers (nicht auf Modul-Ebene): mehrere
// .pb.js-Hooks werden von PocketBase in einem gemeinsamen Scope ausgefuehrt,
// ein Top-Level-const mit demselben Namen in zwei Dateien kollidiert sonst.
onRecordAfterCreateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const workout = e.record;
    const boxId = workout.getString("box");
    const publishedBy = workout.getString("publishedBy");
    const members = $app.findRecordsByFilter(
      "memberships",
      `box = {:box} && status = "active"`,
      "",
      0, 0,
      { box: boxId }
    );
    const title = "Neues WOD 🏋️";
    const body = workout.getString("name") || "Ein neues Workout wurde veroeffentlicht.";
    for (const m of members) {
      const userId = m.getString("user");
      if (userId === publishedBy) continue;
      notify.sendPushToUser(userId, "newWorkout", title, body);
    }
  } catch (err) {
    console.log("social_notifications (box_workouts) Hook-Fehler", err);
  }
  e.next();
}, "box_workouts");

onRecordAfterCreateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const post = e.record;
    const pollOptions = post.get("pollOptions");
    if (!pollOptions || !Array.isArray(pollOptions) || !pollOptions.length) {
      e.next();
      return;
    }
    const boxId = post.getString("box");
    const authorId = post.getString("author");
    const members = $app.findRecordsByFilter(
      "memberships",
      `box = {:box} && status = "active"`,
      "",
      0, 0,
      { box: boxId }
    );
    const title = "Neue Umfrage 🗳️";
    const body = post.getString("text") || "Es gibt eine neue Umfrage.";
    for (const m of members) {
      const userId = m.getString("user");
      if (userId === authorId) continue;
      notify.sendPushToUser(userId, "newPoll", title, body);
    }
  } catch (err) {
    console.log("social_notifications (social_posts) Hook-Fehler", err);
  }
  e.next();
}, "social_posts");

onRecordAfterCreateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const comment = e.record;
    const postId = comment.getString("post");
    const commenterId = comment.getString("author");
    const post = $app.findRecordById("social_posts", postId);
    const authorId = post.getString("author");
    if (authorId && authorId !== commenterId) {
      notify.sendPushToUser(authorId, "postComment", "Neuer Kommentar 💬", comment.getString("text") || "");
    }
  } catch (err) {
    console.log("social_notifications (social_comments) Hook-Fehler", err);
  }
  e.next();
}, "social_comments");
