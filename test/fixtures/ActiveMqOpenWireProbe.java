/* Test-only OpenWire/JMS probe. The ActiveMQ distribution supplies the client jars. */
import jakarta.jms.Connection;
import jakarta.jms.BytesMessage;
import jakarta.jms.Destination;
import jakarta.jms.Message;
import jakarta.jms.MessageConsumer;
import jakarta.jms.MessageProducer;
import jakarta.jms.Session;
import jakarta.jms.TextMessage;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.apache.activemq.ActiveMQConnectionFactory;

public class ActiveMqOpenWireProbe {
    public static void main(String[] args) throws Exception {
        if (args.length < 6) throw new IllegalArgumentException("send|receive url user password queue body-or-timeout");
        String action = args[0], url = args[1], user = args[2], password = args[3], queue = args[4];
        ActiveMQConnectionFactory factory = new ActiveMQConnectionFactory(user, password, url);
        try (Connection connection = factory.createConnection()) {
            connection.start();
            try (Session session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE)) {
                Destination destination = session.createQueue(queue);
                if ("send".equals(action)) {
                    try (MessageProducer producer = session.createProducer(destination)) {
                        TextMessage message = session.createTextMessage(args[5]);
                        message.setStringProperty("source", "openwire-jms");
                        producer.send(message);
                        System.out.println("SENT=" + message.getJMSMessageID());
                    }
                } else if ("receive".equals(action)) {
                    try (MessageConsumer consumer = session.createConsumer(destination)) {
                        Message message = consumer.receive(Long.parseLong(args[5]));
                        if (message == null) throw new IllegalStateException("Timed out waiting for OpenWire/JMS message");
                        String body;
                        if (message instanceof TextMessage text) {
                            body = text.getText();
                        } else if (message instanceof BytesMessage bytes) {
                            bytes.reset();
                            byte[] value = new byte[(int) bytes.getBodyLength()];
                            bytes.readBytes(value);
                            body = new String(value, StandardCharsets.UTF_8);
                        } else {
                            body = message.getBody(String.class);
                        }
                        System.out.println("BODY_BASE64=" + Base64.getEncoder().encodeToString(body.getBytes(StandardCharsets.UTF_8)));
                        System.out.println("MESSAGE_ID=" + message.getJMSMessageID());
                    }
                } else throw new IllegalArgumentException("Unknown action: " + action);
            }
        }
    }
}
