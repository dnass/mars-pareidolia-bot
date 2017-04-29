import cv2
import sys
import urllib
import json
import numpy as np
from os.path import basename


def getFace(url, classifiers, dirpath):
    classifiers = classifiers.split(',')
    resp = urllib.urlopen(url)
    image = np.asarray(bytearray(resp.read()), dtype="uint8")
    image = cv2.imdecode(image, cv2.IMREAD_COLOR)

    if image is not None:
        for c in classifiers:
            faces = cv2.CascadeClassifier('{}/classifiers/{}'.format(dirpath, c)).detectMultiScale(
                image,
                scaleFactor=1.07,
                minNeighbors=9,
                minSize=(30, 30),
                maxSize=(150, 150),
                flags=0
            )

            # Draw a rectangle around the faces
            if len(faces):
                for (x, y, w, h) in faces:
                    cv2.rectangle(image, (x, y), (x + w, y + h),
                                  (0, 0, 255), 2)
                filepath = '{}/queue/{}'.format(dirpath, basename(url))
                cv2.imwrite(filepath, image)
                output = json.dumps(
                    {'filepath': filepath, 'sourceUrl': url, 'faceCount': len(faces), 'classifier': basename(c)})
                break
            else:
                output = 'null'

        print output
        sys.stdout.flush()


getFace(sys.argv[1], sys.argv[2], sys.argv[3])
